// Circuit Board Animation - Wall-Following Car
// Car starts in center, moves forward, turns left when hitting obstacles

//
// Car model - moves in discrete steps on hexagonal grid
//
var Car = function(x, y, canvasWidth, canvasHeight, hexSize, phase, strategy, carId) {
    this.x = x;
    this.y = y;
    this.hexSize = hexSize;
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    this.phase = phase || 1;
    this.stuck = false;
    this.id = carId; // Unique ID for this car
    this.birthTime = Date.now(); // Track when this car was born
    this.hueOffset = Math.random() * 360; // Each car gets unique base hue
    this.color = this.getColor();

    // Fitness tracking
    this.distanceTraveled = 0; // Total distance moved
    this.cellsVisited = 0; // Number of unique cells visited

    // Strategy can be passed in (fitness-based) or random (fallback)
    if (strategy) {
        this.strategy = strategy;
    } else {
        var strategies = ['wall-follower', 'wanderer', 'explorer', 'spiral'];
        this.strategy = strategies[Math.floor(Math.random() * strategies.length)];
    }

    // Each car picks a preferred turning direction at birth and maintains it for life
    this.preferredTurnDirection = Math.random() < 0.5 ? 'right' : 'left';
    this.previousDirection = null; // Track where we came from to calculate turn angle
    this.straightMoves = 0; // Track consecutive straight moves for wanderer strategy

    var rowHeight = hexSize * 0.866; // sqrt(3)/2

    // Hexagonal grid directions - 6 directions
    this.hexDirections = [
        { angle: 0, dx: hexSize, dy: 0 },                    // East
        { angle: Math.PI / 3, dx: hexSize / 2, dy: rowHeight },      // SE
        { angle: 2 * Math.PI / 3, dx: -hexSize / 2, dy: rowHeight }, // SW
        { angle: Math.PI, dx: -hexSize, dy: 0 },                     // West
        { angle: 4 * Math.PI / 3, dx: -hexSize / 2, dy: -rowHeight },// NW
        { angle: 5 * Math.PI / 3, dx: hexSize / 2, dy: -rowHeight }  // NE
    ];

    this.currentDirection = Math.floor(Math.random() * 6); // Start in random direction
};

Car.prototype.getColor = function() {
    // Normalize position (x and y are already in pixels)
    var xRatio = Math.max(0, Math.min(1, this.x / this.canvasWidth));
    var yRatio = Math.max(0, Math.min(1, this.y / this.canvasHeight));

    // Global time-based cycling (all cars see same global time)
    var globalTime = (Date.now() % 10000) / 10000; // 0 to 1 over 10 seconds
    var globalHueShift = Math.sin(globalTime * Math.PI * 2) * 20; // ±20° global shift

    // Car's individual lifetime (creates unique color per car based on birth time)
    var lifetime = (Date.now() - this.birthTime) / 1000; // seconds since birth
    var lifetimeHueShift = Math.sin(lifetime * 0.5) * 15; // ±15° based on car age

    // Each car has unique base hue + position variation + time variations
    var baseHue = this.hueOffset + (xRatio * 60); // Car's unique hue + position gradient
    var hue = (baseHue + globalHueShift + lifetimeHueShift) % 360; // Combined time effects

    // Saturation and lightness with time variations
    var sat = 85 + yRatio * 15 + Math.cos(globalTime * Math.PI * 2) * 5; // 80-100%
    var light = 45 + yRatio * 10 + Math.sin(globalTime * Math.PI * 4) * 5; // 40-60%

    return 'hsla(' + ~~hue + ', ' + ~~sat + '%, ' + ~~light + '%, 1)';
};

Car.prototype.getHexKey = function(x, y) {
    // Create unique key for each grid position
    // Round to nearest integer to handle floating point precision
    return Math.round(x) + ',' + Math.round(y);
};

Car.prototype.tryDirection = function(dirIndex, occupiedCells, canvasWidth, canvasHeight, allLines) {
    var dir = this.hexDirections[dirIndex];
    var nextX = this.x + dir.dx;
    var nextY = this.y + dir.dy;

    // Check bounds
    if (nextX < 0 || nextX >= canvasWidth || nextY < 0 || nextY >= canvasHeight) {
        return null;
    }

    // CRITICAL: Check if destination grid point has EVER been visited by ANY car
    // Grid points can NEVER be visited more than once - this is an absolute rule
    var key = this.getHexKey(nextX, nextY);
    if (occupiedCells[key]) {
        return null; // Position already visited - reject this move
    }

    // CRITICAL: Check ALL grid points along the path (not just destination!)
    // This prevents cars from "jumping over" occupied grid points
    var numSteps = 3; // Check multiple points along the line
    for (var step = 1; step < numSteps; step++) {
        var ratio = step / numSteps;
        var checkX = this.x + dir.dx * ratio;
        var checkY = this.y + dir.dy * ratio;

        // Find nearest grid point to this position
        var rowHeight = this.hexSize * 0.866;
        var approxRow = Math.round(checkY / rowHeight);
        var xOffset = (approxRow % 2 === 0) ? 0 : this.hexSize / 2;
        var approxCol = Math.round((checkX - xOffset) / this.hexSize);
        var gridX = approxCol * this.hexSize + xOffset;
        var gridY = approxRow * rowHeight;

        // Check if close to an occupied grid point
        var distance = Math.sqrt(Math.pow(checkX - gridX, 2) + Math.pow(checkY - gridY, 2));
        if (distance < this.hexSize * 0.6) { // Within 60% of hex size
            var checkKey = this.getHexKey(gridX, gridY);
            if (occupiedCells[checkKey] && checkKey !== this.getHexKey(this.x, this.y)) {
                return null; // Path passes through occupied grid point
            }
        }
    }

    // Check if this line would cross any existing lines
    // Only check recent lines for performance (spatial locality)
    var checkStart = Math.max(0, allLines.length - 100); // Only check last 100 lines
    for (var i = checkStart; i < allLines.length; i++) {
        var line = allLines[i];
        if (this.linesIntersect(this.x, this.y, nextX, nextY, line.x1, line.y1, line.x2, line.y2)) {
            return null; // Would cross existing line
        }
    }

    return { x: nextX, y: nextY, direction: dirIndex };
};

Car.prototype.linesIntersect = function(x1, y1, x2, y2, x3, y3, x4, y4) {
    // Check if line segments (x1,y1)-(x2,y2) and (x3,y3)-(x4,y4) intersect
    // Skip if they share an endpoint (threshold scales with hex size)
    var threshold = this.hexSize * 0.15; // 15% of hex size
    if ((Math.abs(x1 - x3) < threshold && Math.abs(y1 - y3) < threshold) ||
        (Math.abs(x1 - x4) < threshold && Math.abs(y1 - y4) < threshold) ||
        (Math.abs(x2 - x3) < threshold && Math.abs(y2 - y3) < threshold) ||
        (Math.abs(x2 - x4) < threshold && Math.abs(y2 - y4) < threshold)) {
        return false;
    }

    var denom = ((y4 - y3) * (x2 - x1)) - ((x4 - x3) * (y2 - y1));
    if (Math.abs(denom) < 0.0001) {
        return false; // Lines are parallel
    }

    var ua = (((x4 - x3) * (y1 - y3)) - ((y4 - y3) * (x1 - x3))) / denom;
    var ub = (((x2 - x1) * (y1 - y3)) - ((y2 - y1) * (x1 - x3))) / denom;

    // Check if intersection point is within both line segments (with small margins)
    return (ua > 0.05 && ua < 0.95 && ub > 0.05 && ub < 0.95);
};

//
// CircuitBoard
//
var CircuitBoard = function(options) {
    options = options || {};
    this.canvas = null;
    this.ctx = null;
    this.hexSize = options.hexSize || 100; // Hexagonal step size in pixels
    this.occupiedCells = {}; // Track which hex positions are occupied
    this.cellTimestamps = {}; // Track when each cell was drawn
    this.cellOwners = {}; // Track which car owns each cell (by car ID)
    this.allLines = []; // Track all drawn line segments for collision detection
    this.cars = []; // Active cars
    this.maxCars = options.maxCars || 2; // Maximum simultaneous cars
    this.nextCarId = 0; // Unique ID counter for cars
    this.deadCarIds = {}; // Track IDs of cars that have died (key = carId, value = death timestamp)

    // Strategy fitness tracking - survival of the fittest
    this.strategyFitness = {
        'wall-follower': { totalLifetime: 0, count: 0, totalDistance: 0, totalCells: 0 },
        'wanderer': { totalLifetime: 0, count: 0, totalDistance: 0, totalCells: 0 },
        'explorer': { totalLifetime: 0, count: 0, totalDistance: 0, totalCells: 0 },
        'spiral': { totalLifetime: 0, count: 0, totalDistance: 0, totalCells: 0 }
    };

    // Evolution parameters
    this.mutationRate = options.mutationRate !== undefined ? options.mutationRate : 0.1; // 10% chance of random strategy

    // Trace lifetime modes
    this.infiniteLifetime = options.infiniteLifetime !== undefined ? options.infiniteLifetime : false; // Default: fading enabled
    this.traceLifetime = options.traceLifetime !== undefined ? options.traceLifetime : 2.0; // Default 2 seconds
    this.fadeDuration = options.fadeDuration !== undefined ? options.fadeDuration : 1.0; // Default 1 second

    this.lineWidth = options.lineWidth !== undefined ? options.lineWidth : 10; // Line width - default 10px
    this.drawCounter = 0;
    this.animationId = null;
    this.stepDelay = options.stepDelay !== undefined ? options.stepDelay : 10; // Milliseconds between steps - default 10ms
    this.lastStepTime = 0;
    this.spawnDelay = options.spawnDelay !== undefined ? options.spawnDelay : 100; // Milliseconds between spawning new cars - default 100ms
    this.lastSpawnTime = 0;
    this.theme = document.documentElement.getAttribute('data-theme') || 'dark';
    this.lastCanvasWidth = 0;
    this.lastCanvasHeight = 0;
    this.resizeTimeout = null;
    this.animationComplete = false; // Track when canvas is fully filled
    this.finalDotsDrawn = false; // Track if we've drawn remaining dots

    // Defaults are now handled by || operators above
    // Demo always provides options, so no need for this block

    // init
    this.init();
};

CircuitBoard.prototype.init = function() {
    this.setup();

    // Spawn initial cars with delay between each
    // If spawnDelay is 0, spawn all immediately
    if (this.spawnDelay === 0) {
        for (var i = 0; i < this.maxCars; i++) {
            this.spawnCar();
        }
    }
    // Otherwise, let the animate loop handle spawning with delays

    this.animate();
};

CircuitBoard.prototype.setup = function() {
    // Remove any existing circuit board canvases first
    var existingCanvases = document.querySelectorAll('canvas[style*="position: fixed"]');
    for (var i = 0; i < existingCanvases.length; i++) {
        if (existingCanvases[i].parentNode) {
            existingCanvases[i].parentNode.removeChild(existingCanvases[i]);
        }
    }

    // create canvas - extend beyond visible area for seamless patterns
    var margin = 300; // Extra space on each side
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'circuit-board-canvas';
    this.canvas.width = window.innerWidth + (margin * 2);
    this.canvas.height = window.innerHeight + (margin * 2);

    this.canvas.style.cssText = `
        position: fixed;
        top: -${margin}px;
        left: -${margin}px;
        width: calc(100% + ${margin * 2}px);
        height: calc(100% + ${margin * 2}px);
        z-index: 0;
        pointer-events: none;
        opacity: ${this.theme === 'light' ? '0.35' : '0'};
        display: block;
        transition: opacity 1.5s ease;
        background: black;
    `;

    document.body.insertBefore(this.canvas, document.body.firstChild);
    this.ctx = this.canvas.getContext('2d');

    // Store initial size to detect actual resize changes
    this.lastCanvasWidth = this.canvas.width;
    this.lastCanvasHeight = this.canvas.height;

    // handle window resize
    window.addEventListener('resize', this.onResize.bind(this));
};

CircuitBoard.prototype.createObstacles = function() {
    // No obstacles - car will spiral freely
    this.obstacles = [];
};

CircuitBoard.prototype.selectStrategyByFitness = function() {
    var strategies = ['wall-follower', 'wanderer', 'explorer', 'spiral'];

    // MUTATION: Random strategy with probability = mutationRate
    if (Math.random() < this.mutationRate) {
        return strategies[Math.floor(Math.random() * strategies.length)];
    }

    // Calculate fitness-based weights using multiple metrics
    var weights = [];
    var totalWeight = 0;

    for (var i = 0; i < strategies.length; i++) {
        var strategy = strategies[i];
        var fitness = this.strategyFitness[strategy];

        if (fitness.count > 0) {
            // Combined fitness: lifetime + distance + cells visited
            var avgLifetime = fitness.totalLifetime / fitness.count;
            var avgDistance = fitness.totalDistance / fitness.count;
            var avgCells = fitness.totalCells / fitness.count;

            // Weighted combination: prioritize cells visited and lifetime
            var combinedFitness = (avgCells * 2) + avgLifetime + (avgDistance / 100);
            var weight = Math.pow(combinedFitness, 2); // Squared for stronger selection
            weights.push(weight);
            totalWeight += weight;
        } else {
            weights.push(1.0); // No data yet
            totalWeight += 1.0;
        }
    }

    // If no data yet, use equal weights
    if (totalWeight === 0) {
        return strategies[Math.floor(Math.random() * strategies.length)];
    }

    // Weighted random selection
    var random = Math.random() * totalWeight;
    var cumulativeWeight = 0;

    for (var i = 0; i < strategies.length; i++) {
        cumulativeWeight += weights[i];
        if (random <= cumulativeWeight) {
            return strategies[i];
        }
    }

    return strategies[strategies.length - 1]; // Fallback
};

CircuitBoard.prototype.spawnCar = function() {
    // Select strategy based on fitness (survival of the fittest)
    var selectedStrategy = this.selectStrategyByFitness();

    // Try to find an unoccupied random hexagonal grid position
    var rowHeight = this.hexSize * 0.866;
    var maxAttempts = 100;
    var attempts = 0;

    while (attempts < maxAttempts) {
        var row = Math.floor(Math.random() * (this.canvas.height / rowHeight));
        var col = Math.floor(Math.random() * (this.canvas.width / this.hexSize));

        var xOffset = (row % 2 === 0) ? 0 : this.hexSize / 2;
        var gridX = col * this.hexSize + xOffset;
        var gridY = row * rowHeight;

        // CRITICAL: Use exact same key generation as everywhere else
        var key = this.getHexKey(gridX, gridY);
        if (!this.occupiedCells[key]) {
            // Spawn with fitness-selected strategy and unique ID
            var carId = this.nextCarId++;
            var car = new Car(gridX, gridY, this.canvas.width, this.canvas.height, this.hexSize, null, selectedStrategy, carId);
            car.prevX = gridX;
            car.prevY = gridY;
            this.occupiedCells[key] = (this.occupiedCells[key] || 0) + 1;
            this.cellTimestamps[key] = Date.now();
            this.cellOwners[key] = carId; // Track that this car owns this cell

            this.cars.push(car);
            return true; // Successfully spawned
        }

        attempts++;
    }

    // Random search failed - do exhaustive search for any remaining free spots
    var numRows = Math.ceil(this.canvas.height / rowHeight);
    var numCols = Math.ceil(this.canvas.width / this.hexSize);

    for (var row = 0; row < numRows; row++) {
        var xOffset = (row % 2 === 0) ? 0 : this.hexSize / 2;

        for (var col = 0; col < numCols; col++) {
            var gridX = col * this.hexSize + xOffset;
            var gridY = row * rowHeight;

            // Check bounds
            if (gridX >= 0 && gridX < this.canvas.width && gridY >= 0 && gridY < this.canvas.height) {
                // CRITICAL: Use exact same key generation as everywhere else
                var key = this.getHexKey(gridX, gridY);
                if (!this.occupiedCells[key]) {
                    // Found a free spot - spawn with fitness-selected strategy and unique ID
                    var carId = this.nextCarId++;
                    var car = new Car(gridX, gridY, this.canvas.width, this.canvas.height, this.hexSize, null, selectedStrategy, carId);
                    car.prevX = gridX;
                    car.prevY = gridY;
                    this.occupiedCells[key] = (this.occupiedCells[key] || 0) + 1;
                    this.cellTimestamps[key] = Date.now();
                    this.cellOwners[key] = carId; // Track that this car owns this cell

                    this.cars.push(car);
                    return true; // Successfully spawned
                }
            }
        }
    }

    // No free spots left - cells will be recycled later
    return false;
};

CircuitBoard.prototype.onResize = function() {
    var margin = 300; // Extra space on each side
    var newWidth = window.innerWidth + (margin * 2);
    var newHeight = window.innerHeight + (margin * 2);

    // Ignore small changes (mobile address bar show/hide, scroll bounce)
    // Only reset if width or height changed by more than 150px
    var widthChange = Math.abs(newWidth - this.lastCanvasWidth);
    var heightChange = Math.abs(newHeight - this.lastCanvasHeight);

    if (widthChange < 150 && heightChange < 150) {
        // Don't touch canvas at all - changing width/height clears it!
        return;
    }

    // Significant size change - debounce heavily to avoid scroll triggers
    if (this.resizeTimeout) {
        clearTimeout(this.resizeTimeout);
    }

    var self = this;
    this.resizeTimeout = setTimeout(function() {
        // Clear and resize canvas
        self.canvas.width = newWidth;
        self.canvas.height = newHeight;
        self.lastCanvasWidth = newWidth;
        self.lastCanvasHeight = newHeight;

        // Fill with background color
        self.ctx.fillStyle = 'rgba(240, 249, 255, 0.95)';
        self.ctx.fillRect(0, 0, self.canvas.width, self.canvas.height);

        // Restart animation completely - clear all state
        self.cars = [];
        self.occupiedCells = {};
        self.cellTimestamps = {};
        self.cellOwners = {};
        self.deadCarIds = {};
        self.allLines = [];
        self.animationComplete = false;
        self.finalDotsDrawn = false;

        // Reset spawn time so delays work correctly
        self.lastSpawnTime = 0;

        // Spawn new cars with current settings
        // If spawnDelay is 0, spawn all immediately
        if (self.spawnDelay === 0) {
            for (var i = 0; i < self.maxCars; i++) {
                self.spawnCar();
            }
        }
        // Otherwise, let the animate loop handle spawning with delays
    }, 500); // Longer debounce to avoid scroll triggers
};

CircuitBoard.prototype.animate = function() {
    this.animationId = requestAnimationFrame(this.animate.bind(this));
    this.draw();
};

CircuitBoard.prototype.draw = function() {
    // Animation runs continuously - no completion state needed
    if (false) { // Disabled legacy completion code
        if (!this.finalDotsDrawn) {
            this.drawRemainingDots();
            this.finalDotsDrawn = true;

            // Legacy phase transition code removed
            if (false) {
            }
        }
        return;
    }

    var currentTime = Date.now();

    // Get set of alive car IDs for quick lookup
    var aliveCarIds = {};
    for (var i = 0; i < this.cars.length; i++) {
        aliveCarIds[this.cars[i].id] = true;
    }

    // Clear and redraw everything each frame to show proper fading
    // Clear entire canvas
    this.ctx.fillStyle = 'rgb(0, 0, 0)';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw all lines with temporal color gradient (each segment has its own color based on age)
    this.ctx.lineWidth = this.lineWidth;
    this.ctx.lineCap = 'round'; // Round caps for smooth endpoints
    this.ctx.lineJoin = 'round'; // Round joins for smooth corners

    // Group consecutive segments by car to draw as continuous paths
    var carSegments = {};
    for (var i = 0; i < this.allLines.length; i++) {
        var line = this.allLines[i];
        if (line.carId !== undefined) {
            if (!carSegments[line.carId]) {
                carSegments[line.carId] = [];
            }
            carSegments[line.carId].push(line);
        }
    }

    // Draw each car's segments as a continuous path with gradient colors
    for (var carId in carSegments) {
        if (carSegments.hasOwnProperty(carId)) {
            var segments = carSegments[carId];
            var numCarId = parseInt(carId);
            var isAlive = aliveCarIds[numCarId];

            // Calculate darkness factor based on mode
            var darknessFactor = 1.0; // 1.0 = full brightness, 0.0 = black

            if (!this.infiniteLifetime && !isAlive) {
                // Fading mode - fade dead car traces
                var deathTime = this.deadCarIds[numCarId];
                if (deathTime !== undefined) {
                    var timeSinceDeath = currentTime - deathTime;
                    var lifetimeMs = this.traceLifetime * 1000;

                    // Stay at full brightness during lifetime
                    if (timeSinceDeath <= lifetimeMs) {
                        darknessFactor = 1.0; // Full brightness during lifetime
                    } else {
                        // After lifetime ends, start fading over fadeDuration
                        var fadeStartTime = timeSinceDeath - lifetimeMs;
                        var fadeDurationMs = this.fadeDuration * 1000;
                        var fadeProgress = Math.min(1, fadeStartTime / fadeDurationMs);
                        darknessFactor = 1 - fadeProgress; // Fade brightness from 1 to 0
                    }
                }
            }
            // Infinite lifetime mode - all traces stay at full brightness (darknessFactor = 1.0)

            // Draw segments with individual colors (recalculated each frame for flowing effect)
            this.ctx.beginPath();
            for (var i = 0; i < segments.length; i++) {
                var segment = segments[i];

                // Calculate color freshly each frame (includes all time-dependent effects)
                var color = this.getSegmentColor(segment, this.canvas.width, this.canvas.height);

                // Reduce lightness as car fades (darker, not transparent)
                var fadedLight = Math.round(color.light * darknessFactor);
                var strokeStyle = 'hsl(' + color.hue + ', ' + color.sat + '%, ' + fadedLight + '%)';

                // Check if this is a dot (zero-length line)
                if (segment.x1 === segment.x2 && segment.y1 === segment.y2) {
                    // Draw as a dot
                    this.ctx.fillStyle = strokeStyle;
                    this.ctx.beginPath();
                    this.ctx.arc(segment.x1, segment.y1, this.lineWidth / 2, 0, Math.PI * 2);
                    this.ctx.fill();
                } else {
                    // Draw as a line
                    this.ctx.strokeStyle = strokeStyle;
                    this.ctx.beginPath();
                    this.ctx.moveTo(segment.x1, segment.y1);
                    this.ctx.lineTo(segment.x2, segment.y2);
                    this.ctx.stroke();
                }
            }
        }
    }

    // Clear faded cells so they can be reused
    this.clearFadedCells(currentTime, aliveCarIds);

    // Draw hexagonal grid - disabled
    // this.drawHexGrid();

    // Only update cars at set intervals (discrete steps)
    if (currentTime - this.lastStepTime >= this.stepDelay) {
        this.lastStepTime = currentTime;

        // PHASE 1: Calculate all intended moves
        var intendedMoves = [];
        for (var i = 0; i < this.cars.length; i++) {
            var car = this.cars[i];
            if (!car.stuck) {
                var move = this.calculateMove(car);
                intendedMoves.push({
                    car: car,
                    move: move,
                    carIndex: i
                });
            }
        }

        // PHASE 2: Detect conflicts (multiple cars wanting same destination)
        // CRITICAL: Snap all destinations to grid first before checking conflicts
        var rowHeight = this.hexSize * 0.866;
        var destinationCounts = {};
        for (var i = 0; i < intendedMoves.length; i++) {
            if (intendedMoves[i].move) {
                // Snap to exact grid point
                var row = Math.round(intendedMoves[i].move.y / rowHeight);
                var xOffset = (row % 2 === 0) ? 0 : this.hexSize / 2;
                var col = Math.round((intendedMoves[i].move.x - xOffset) / this.hexSize);
                var snappedX = col * this.hexSize + xOffset;
                var snappedY = row * rowHeight;

                var destKey = this.getHexKey(snappedX, snappedY);
                destinationCounts[destKey] = (destinationCounts[destKey] || 0) + 1;

                // Store snapped coordinates for later
                intendedMoves[i].snappedDestKey = destKey;
            }
        }

        // PHASE 3: Execute only non-conflicting moves
        for (var i = 0; i < intendedMoves.length; i++) {
            var entry = intendedMoves[i];
            if (entry.move && entry.snappedDestKey) {
                // Only move if no other car wants this destination
                if (destinationCounts[entry.snappedDestKey] === 1) {
                    this.executeMove(entry.car, entry.move);
                } else {
                    // Conflict detected - multiple cars want same spot
                    // Check if this is a head-on collision (cars driving straight towards each other)
                    var carsInConflict = [];
                    for (var j = 0; j < intendedMoves.length; j++) {
                        if (intendedMoves[j].snappedDestKey === entry.snappedDestKey && intendedMoves[j].move) {
                            carsInConflict.push(intendedMoves[j]);
                        }
                    }

                    // If exactly 2 cars, check if they're driving straight towards each other
                    if (carsInConflict.length === 2) {
                        var car1 = carsInConflict[0].car;
                        var car2 = carsInConflict[1].car;
                        var move1 = carsInConflict[0].move;
                        var move2 = carsInConflict[1].move;

                        // Check if both are going straight (not turning)
                        var car1Straight = (move1.direction === car1.currentDirection);
                        var car2Straight = (move2.direction === car2.currentDirection);

                        // Check if they're facing opposite directions (180° apart)
                        var directionDiff = Math.abs(car1.currentDirection - car2.currentDirection);
                        var isHeadOn = (directionDiff === 3) && car1Straight && car2Straight;

                        // Always let first car win, second tries alternate path
                        // (Head-on detection disabled - was causing too many deaths)
                        this.executeMove(carsInConflict[0].car, carsInConflict[0].move);
                        // Second car doesn't move this turn but isn't stuck
                    } else {
                        // More than 2 cars or other conflict - first wins
                        this.executeMove(carsInConflict[0].car, carsInConflict[0].move);
                    }

                    // Mark this entry as processed
                    entry.move = null;
                }
            } else {
                // No valid move found - car dies on the spot
                entry.car.stuck = true;

                // Draw a dot at the death position so there's at least a visible mark
                this.ctx.fillStyle = entry.car.color;
                this.ctx.beginPath();
                this.ctx.arc(entry.car.x, entry.car.y, this.lineWidth / 2, 0, Math.PI * 2);
                this.ctx.fill();

                // Also record this as a "line" so it appears in the trace system
                var deathDot = {
                    x1: entry.car.x,
                    y1: entry.car.y,
                    x2: entry.car.x,
                    y2: entry.car.y,
                    carId: entry.car.id,
                    hueOffset: entry.car.hueOffset,
                    birthTime: entry.car.birthTime,
                    timestamp: Date.now(),
                    segmentIndex: this.allLines.filter(function(l) { return l.carId === entry.car.id; }).length
                };
                this.allLines.push(deathDot);
            }
        }

        // PHASE 4: Handle stuck cars - they become permanent, don't die
        var stuckCars = [];
        for (var i = this.cars.length - 1; i >= 0; i--) {
            var car = this.cars[i];

            if (car.stuck) {
                // Record fitness: lifetime, distance, and cells visited
                var lifetime = (Date.now() - car.birthTime) / 1000; // seconds
                if (this.strategyFitness[car.strategy]) {
                    this.strategyFitness[car.strategy].totalLifetime += lifetime;
                    this.strategyFitness[car.strategy].totalDistance += car.distanceTraveled;
                    this.strategyFitness[car.strategy].totalCells += car.cellsVisited;
                    this.strategyFitness[car.strategy].count += 1;
                }

                // Mark as dead but keep trace permanently
                this.deadCarIds[car.id] = Date.now();
                stuckCars.push(car);

                // Remove from active cars
                this.cars.splice(i, 1);
            }
        }

        // Spawn new cars one at a time with delay - animation never stops
        if (this.cars.length < this.maxCars && currentTime - this.lastSpawnTime >= this.spawnDelay) {
            var spawnSuccess = this.spawnCar();

            // Infinite lifetime mode: if spawn failed due to full canvas, remove oldest dead car
            if (this.infiniteLifetime && !spawnSuccess && Object.keys(this.deadCarIds).length > 0) {
                // Find oldest dead car by looking at death timestamps
                var oldestCarId = null;
                var oldestDeathTime = Infinity;

                for (var carId in this.deadCarIds) {
                    if (this.deadCarIds[carId] < oldestDeathTime) {
                        oldestDeathTime = this.deadCarIds[carId];
                        oldestCarId = parseInt(carId);
                    }
                }

                if (oldestCarId !== null) {
                    // Remove oldest dead car's traces and cells to free up space
                    this.removeCarTraces(oldestCarId);
                    // Try spawning again after making room
                    this.spawnCar();
                }
            }
            this.lastSpawnTime = currentTime;
        }
    }
};

CircuitBoard.prototype.drawHexGrid = function() {
    var ctx = this.ctx;
    var hexSize = this.hexSize;

    ctx.fillStyle = 'rgba(0, 130, 190, 0.3)';

    // Hexagonal grid with offset rows
    var rowHeight = hexSize * 0.866; // sqrt(3)/2

    for (var row = 0; row <= this.canvas.height / rowHeight; row++) {
        var y = row * rowHeight;
        var xOffset = (row % 2 === 0) ? 0 : hexSize / 2;

        for (var col = 0; col <= this.canvas.width / hexSize + 1; col++) {
            var x = col * hexSize + xOffset;

            if (x >= 0 && x <= this.canvas.width && y >= 0 && y <= this.canvas.height) {
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
};

CircuitBoard.prototype.getHexKey = function(x, y) {
    return Math.round(x) + ',' + Math.round(y);
};

CircuitBoard.prototype.getSegmentColor = function(segment, canvasWidth, canvasHeight) {
    // Recalculate base color from segment position (like Car.getColor does)
    var xRatio = Math.max(0, Math.min(1, segment.x1 / canvasWidth));
    var yRatio = Math.max(0, Math.min(1, segment.y1 / canvasHeight));

    // Global time-based cycling
    var globalTime = (Date.now() % 10000) / 10000;
    var globalHueShift = Math.sin(globalTime * Math.PI * 2) * 20;

    // Car's lifetime-based shift
    var lifetime = (Date.now() - segment.birthTime) / 1000;
    var lifetimeHueShift = Math.sin(lifetime * 0.5) * 15;

    // Base color calculation (same as Car.getColor)
    var baseHue = segment.hueOffset + (xRatio * 60);
    var hue = (baseHue + globalHueShift + lifetimeHueShift) % 360;
    var sat = 85 + yRatio * 15 + Math.cos(globalTime * Math.PI * 2) * 5;
    var light = 45 + yRatio * 10 + Math.sin(globalTime * Math.PI * 4) * 5;

    // Additional drift components
    var currentTime = Date.now() / 1000;

    // Global drift (all traces together)
    var globalDrift = Math.sin(currentTime * 0.05) * 15;

    // Per-segment age drift
    var age = (Date.now() - segment.timestamp) / 1000;
    var ageDrift = Math.sin(age * 0.1) * 20;

    // Flowing effect: colors propagate along the path
    var flowingDrift = 0;
    if (segment.segmentIndex !== undefined) {
        var flowSpeed = 2.0;
        var flowPhase = (segment.segmentIndex * 0.5) + (currentTime * flowSpeed);
        flowingDrift = Math.sin(flowPhase) * 50;
    }

    // Combine all drifts
    var totalDrift = globalDrift + ageDrift + flowingDrift;
    hue = (hue + totalDrift + 360) % 360;

    return {hue: ~~hue, sat: ~~sat, light: ~~light};
};

CircuitBoard.prototype.calculateMove = function(car) {
    // Turn angle is measured RELATIVE to where the car came from
    // Straight ahead = continue in same direction as currentDirection
    var straightAhead = car.currentDirection;
    var priorities;

    // Strategy-based movement priorities
    if (car.strategy === 'wanderer') {
        // Wanderer: strongly prefers straight, occasional random turns
        priorities = [
            straightAhead,                      // 0° - straight (TRY FIRST)
            (straightAhead + (Math.random() < 0.5 ? 1 : 5)) % 6, // Random 60° turn
            (straightAhead + (Math.random() < 0.5 ? 2 : 4)) % 6, // Random 120° turn
            (straightAhead + 3) % 6,           // 180° reverse
            (straightAhead + 1) % 6,           // 60° right
            (straightAhead + 5) % 6            // 60° left
        ];
    } else if (car.strategy === 'spiral') {
        // Spiral: always tries to turn in one direction to create tight spirals
        var turnDir = car.preferredTurnDirection === 'right' ? 1 : 5;
        priorities = [
            (straightAhead + turnDir) % 6,     // Sharp turn in preferred direction - TRY FIRST
            (straightAhead + turnDir * 2) % 6, // Larger turn in same direction
            straightAhead,                      // Straight if can't turn
            (straightAhead + 3) % 6,           // 180° reverse
            (straightAhead + (turnDir === 1 ? 5 : 1)) % 6, // Opposite turn
            (straightAhead + (turnDir === 1 ? 4 : 2)) % 6
        ];
    } else if (car.strategy === 'explorer') {
        // Explorer: randomizes direction priorities to explore widely
        priorities = [0, 1, 2, 3, 4, 5].map(function(i) { return (straightAhead + i) % 6; });
        // Shuffle the priorities for more randomness
        for (var i = priorities.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var temp = priorities[i];
            priorities[i] = priorities[j];
            priorities[j] = temp;
        }
    } else {
        // Default wall-follower strategy
        if (car.preferredTurnDirection === 'right') {
            // Right turn: sharp turn FIRST, then straight, then larger turns
            priorities = [
                (straightAhead + 1) % 6,           // 60° right turn (sharp) - TRY FIRST
                straightAhead,                      // 0° - straight (continue same direction)
                (straightAhead + 2) % 6,           // 120° right turn
                (straightAhead + 3) % 6,           // 180° (reverse - back where we came)
                (straightAhead + 4) % 6,           // 240° left turn
                (straightAhead + 5) % 6            // 300° left turn
            ];
        } else {
            // Left turn: sharp turn FIRST, then straight, then larger turns
            priorities = [
                (straightAhead + 5) % 6,           // 300° / -60° left turn (sharp) - TRY FIRST
                straightAhead,                      // 0° - straight (continue same direction)
                (straightAhead + 4) % 6,           // 240° / -120° left turn
                (straightAhead + 3) % 6,           // 180° (reverse - back where we came)
                (straightAhead + 2) % 6,           // 120° right turn
                (straightAhead + 1) % 6            // 60° right turn
            ];
        }
    }

    // Try each direction in priority order
    for (var i = 0; i < priorities.length; i++) {
        var dirIndex = priorities[i];
        var move = car.tryDirection(dirIndex, this.occupiedCells, this.canvas.width, this.canvas.height, this.allLines);

        if (move !== null) {
            var score = this.scoreMove(move, car);
            if (score >= 0) {
                // Check if this is a 180° reverse turn
                var turnAngle = (dirIndex - car.currentDirection + 6) % 6;
                var is180Turn = (turnAngle === 3);

                return {
                    x: move.x,
                    y: move.y,
                    direction: move.direction,
                    oldDirection: car.currentDirection,
                    is180: is180Turn  // Flag if this is a reverse turn
                };
            }
        }
    }

    // No valid move found
    return null;
};

CircuitBoard.prototype.executeMove = function(car, move) {
    // CRITICAL: Snap to exact grid point to prevent floating point drift
    var rowHeight = this.hexSize * 0.866;
    var row = Math.round(move.y / rowHeight);
    var xOffset = (row % 2 === 0) ? 0 : this.hexSize / 2;
    var col = Math.round((move.x - xOffset) / this.hexSize);
    var snappedX = col * this.hexSize + xOffset;
    var snappedY = row * rowHeight;

    // CRITICAL: Mark destination as occupied IMMEDIATELY to prevent race conditions
    var key = this.getHexKey(snappedX, snappedY);

    // Double check this position is actually free
    if (this.occupiedCells[key]) {
        // COLLISION DETECTED - this should never happen but safety check
        car.stuck = true;
        return;
    }

    this.occupiedCells[key] = (this.occupiedCells[key] || 0) + 1;
    this.cellTimestamps[key] = Date.now();
    this.cellOwners[key] = car.id; // Track that this car owns this cell

    var oldX = car.x;
    var oldY = car.y;

    car.x = snappedX;
    car.y = snappedY;
    car.previousDirection = car.currentDirection; // Track where we came from

    // Update fitness metrics
    var distance = Math.sqrt(Math.pow(snappedX - oldX, 2) + Math.pow(snappedY - oldY, 2));
    car.distanceTraveled += distance;
    car.cellsVisited += 1; // Each move is to a new unique cell

    // Check if car turned opposite to its preference - if so, switch preference
    var turnAngle = (move.direction - car.currentDirection + 6) % 6;
    if (car.preferredTurnDirection === 'right') {
        // Right-turner made a left turn (60° or 120° left)
        if (turnAngle === 4 || turnAngle === 5) {
            car.preferredTurnDirection = 'left';
        }
    } else {
        // Left-turner made a right turn (60° or 120° right)
        if (turnAngle === 1 || turnAngle === 2) {
            car.preferredTurnDirection = 'right';
        }
    }

    car.currentDirection = move.direction;
    car.color = car.getColor();

    // Draw line
    this.ctx.lineWidth = this.lineWidth;
    this.ctx.strokeStyle = car.color;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.beginPath();
    this.ctx.moveTo(oldX, oldY);
    this.ctx.lineTo(car.x, car.y);
    this.ctx.stroke();

    // Record line with owner, timestamp, and position along path for color drift
    // Store the car's base hue offset (doesn't change) instead of computed color
    var newSegment = {
        x1: oldX,
        y1: oldY,
        x2: car.x,
        y2: car.y,
        carId: car.id,
        hueOffset: car.hueOffset, // Store car's unique hue offset
        birthTime: car.birthTime, // Store car's birth time for color calculation
        timestamp: Date.now(), // Track when line was drawn
        segmentIndex: this.allLines.filter(function(l) { return l.carId === car.id; }).length // Position in sequence
    };
    this.allLines.push(newSegment);

    // Also track continuous path for this car
    if (!this.carPaths) this.carPaths = {};
    if (!this.carPaths[car.id]) {
        this.carPaths[car.id] = {
            points: [oldX, oldY],
            carId: car.id,
            startTime: Date.now()
        };
    }
    // Add next point to path
    this.carPaths[car.id].points.push(car.x, car.y);
};


CircuitBoard.prototype.drawRemainingDots = function() {
    // Fill all remaining unoccupied grid points with dots
    var rowHeight = this.hexSize * 0.866;
    var numRows = Math.ceil(this.canvas.height / rowHeight);
    var numCols = Math.ceil(this.canvas.width / this.hexSize);

    for (var row = 0; row < numRows; row++) {
        var xOffset = (row % 2 === 0) ? 0 : this.hexSize / 2;

        for (var col = 0; col < numCols; col++) {
            var gridX = col * this.hexSize + xOffset;
            var gridY = row * rowHeight;

            if (gridX >= 0 && gridX < this.canvas.width && gridY >= 0 && gridY < this.canvas.height) {
                var key = Math.round(gridX) + ',' + Math.round(gridY);
                if (!this.occupiedCells[key]) {
                    // Draw a dot at this unoccupied position
                    // Create a temporary car just to get the color
                    var tempCar = new Car(gridX, gridY, this.canvas.width, this.canvas.height, this.hexSize);
                    this.ctx.fillStyle = tempCar.color;
                    this.ctx.beginPath();
                    this.ctx.arc(gridX, gridY, this.lineWidth / 2, 0, Math.PI * 2);
                    this.ctx.fill();
                }
            }
        }
    }
};


CircuitBoard.prototype.scoreMove = function(move, car) {
    // If tryDirection returned this move, it's VALID - never reject it
    // Just score it so we pick the best valid move according to priorities
    return 100; // All valid moves are acceptable
};

CircuitBoard.prototype.removeCarTraces = function(carId) {
    // Remove all traces and cells belonging to this car
    var keysToRemove = [];

    // Find all cells owned by this car
    for (var key in this.cellOwners) {
        if (this.cellOwners.hasOwnProperty(key) && this.cellOwners[key] === carId) {
            keysToRemove.push(key);
        }
    }

    // Remove cells
    for (var i = 0; i < keysToRemove.length; i++) {
        delete this.occupiedCells[keysToRemove[i]];
        delete this.cellTimestamps[keysToRemove[i]];
        delete this.cellOwners[keysToRemove[i]];
    }

    // Remove lines
    var newLines = [];
    for (var i = 0; i < this.allLines.length; i++) {
        if (this.allLines[i].carId !== carId) {
            newLines.push(this.allLines[i]);
        }
    }
    this.allLines = newLines;

    // Remove from dead car tracking
    delete this.deadCarIds[carId];

    // Clean up path if exists
    if (this.carPaths) {
        delete this.carPaths[carId];
    }
};

CircuitBoard.prototype.clearFadedCells = function(currentTime, aliveCarIds) {
    // Only run in fading mode
    if (this.infiniteLifetime) {
        return; // Infinite mode - no automatic fading
    }

    // Only run cleanup every 10 frames for better performance
    if (!this.cleanupFrameCounter) this.cleanupFrameCounter = 0;
    this.cleanupFrameCounter++;

    if (this.cleanupFrameCounter % 10 !== 0) {
        return; // Skip cleanup this frame
    }

    // Clear cells and lines when they reach 100% transparency (fully faded)
    var keysToRemove = [];
    var deadCarIdsToCleanup = new Set();

    // Total time before cleanup = lifetime (full brightness) + fade duration
    var totalTimeBeforeCleanup = (this.traceLifetime + this.fadeDuration) * 1000; // in ms

    for (var key in this.cellTimestamps) {
        if (this.cellTimestamps.hasOwnProperty(key)) {
            var ownerId = this.cellOwners[key];

            // Only clear cells from dead cars
            if (ownerId !== undefined && !aliveCarIds[ownerId]) {
                // This cell belongs to a dead car - check if it's fully faded
                var deathTime = this.deadCarIds[ownerId];
                if (deathTime !== undefined) {
                    var timeSinceDeath = currentTime - deathTime;
                    // Remove when fully faded (after lifetime + fade duration)
                    if (timeSinceDeath > totalTimeBeforeCleanup) {
                        keysToRemove.push(key);
                        deadCarIdsToCleanup.add(ownerId);
                    }
                }
            }
        }
    }

    // Remove fully faded cells
    for (var i = 0; i < keysToRemove.length; i++) {
        delete this.occupiedCells[keysToRemove[i]];
        delete this.cellTimestamps[keysToRemove[i]];
        delete this.cellOwners[keysToRemove[i]];
    }

    // Clear fully faded lines - only if we removed cells
    if (keysToRemove.length > 0) {
        var newLines = [];
        for (var i = 0; i < this.allLines.length; i++) {
            var line = this.allLines[i];
            // Keep line if it's from an alive car or a dead car that hasn't fully faded
            if (line.carId && !deadCarIdsToCleanup.has(line.carId)) {
                newLines.push(line);
            }
        }
        this.allLines = newLines;

        // Clean up dead car IDs and paths that have been fully processed
        for (var carId of deadCarIdsToCleanup) {
            delete this.deadCarIds[carId];
            if (this.carPaths) {
                delete this.carPaths[carId];
            }
        }
    }
};

CircuitBoard.prototype.updateTheme = function(theme) {
    this.theme = theme;
    var effectsEnabled = window.visualEffectsToggleInstance?.effectsEnabled !== false;

    if (effectsEnabled) {
        // Simply show or hide the canvas - animation runs to completion regardless
        this.canvas.style.opacity = (theme === 'light') ? '0.35' : '0';
    }
};

CircuitBoard.prototype.destroy = function() {
    if (this.animationId) {
        cancelAnimationFrame(this.animationId);
    }
    if (this.canvas && this.canvas.parentNode) {
        this.canvas.parentNode.removeChild(this.canvas);
    }
};

// Initialize
window.circuitBoardInstance = null;

function initCircuitBoard() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            window.circuitBoardInstance = new CircuitBoard();
        });
    } else {
        window.circuitBoardInstance = new CircuitBoard();
    }
}

// Auto-initialization disabled - demo page handles initialization with custom settings
// initCircuitBoard();
