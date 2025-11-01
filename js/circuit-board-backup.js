// Circuit Board Animation - Wall-Following Car
// Car starts in center, moves forward, turns left when hitting obstacles

//
// Car model - moves in discrete steps on hexagonal grid
//
var Car = function(x, y, canvasWidth, canvasHeight, hexSize, phase) {
    this.x = x;
    this.y = y;
    this.hexSize = hexSize;
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    this.phase = phase || 1;
    this.stuck = false;
    this.color = this.getColor();

    // Each car picks a preferred turning direction at birth and maintains it for life
    this.preferredTurnDirection = Math.random() < 0.5 ? 'right' : 'left';
    this.previousDirection = null; // Track where we came from to calculate turn angle

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

    // Calculate hue based on X position
    // Phase 1: cyan to purple (180-300 degrees)
    // Phase 2: purple to cyan (300-180 degrees) - inverted for smooth middle area
    var hue;
    if (this.phase === 2) {
        hue = 300 - (xRatio * 120); // Reversed: purple to cyan
    } else {
        hue = xRatio * 120 + 180; // Normal: cyan to purple
    }

    // Subtle, closer to white: lower saturation, higher lightness
    var sat = 35 + yRatio * 20; // 35-55% - slightly more visible
    var light = 70 + yRatio * 10; // 70-80% - slightly darker for better visibility

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
    for (var i = 0; i < allLines.length; i++) {
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
    this.allLines = []; // Track all drawn line segments for collision detection
    this.cars = []; // Active cars
    this.maxCars = options.maxCars || 2; // Maximum simultaneous cars
    this.fadeAlpha = options.fadeAlpha !== undefined ? options.fadeAlpha : 0; // No fade - lines stay permanently
    this.lineWidth = options.lineWidth || 120; // Line width - thicker than grid, overlapping
    this.drawCounter = 0;
    this.animationId = null;
    this.stepDelay = options.stepDelay || 25; // Milliseconds between steps - very fast animation
    this.lastStepTime = 0;
    this.theme = document.documentElement.getAttribute('data-theme') || 'dark';
    this.lastCanvasWidth = 0;
    this.lastCanvasHeight = 0;
    this.resizeTimeout = null;
    this.animationComplete = false; // Track when canvas is fully filled
    this.finalDotsDrawn = false; // Track if we've drawn remaining dots

    // Layered animation: Phase 1 = thick/sparse, Phase 2 = thin/dense
    var scaleFactor = Math.max(0.4, Math.min(1.5, window.innerWidth / 1400));
    this.currentPhase = 1;

    // More cars as screen gets bigger
    var phase1Cars = 10;
    var phase2Cars = 15;
    if (window.innerWidth >= 768) {
        phase1Cars = 15;
        phase2Cars = 20;
    }
    if (window.innerWidth >= 1400) {
        phase1Cars = 20;
        phase2Cars = 25;
    }

    this.phase1Config = {
        hexSize: Math.round(100 * scaleFactor),
        maxCars: phase1Cars,
        lineWidth: Math.round(120 * scaleFactor)
    };
    this.phase2Config = {
        hexSize: Math.round(50 * scaleFactor),
        maxCars: phase2Cars,
        lineWidth: Math.round(25 * scaleFactor)
    };

    // init
    this.init();
};

CircuitBoard.prototype.init = function() {
    this.setup();

    // Apply Phase 1 configuration (thick lines)
    this.hexSize = this.phase1Config.hexSize;
    this.maxCars = this.phase1Config.maxCars;
    this.lineWidth = this.phase1Config.lineWidth;

    // Spawn initial cars up to maxCars
    for (var i = 0; i < this.maxCars; i++) {
        this.spawnCar();
    }
    this.animate();
};

CircuitBoard.prototype.setup = function() {
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
        background: rgba(240, 249, 255, 0.95);
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

CircuitBoard.prototype.spawnCar = function() {
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
            // Spawn at any free position - even if stuck, it fills that cell
            var car = new Car(gridX, gridY, this.canvas.width, this.canvas.height, this.hexSize, this.currentPhase);
            car.prevX = gridX;
            car.prevY = gridY;
            this.occupiedCells[key] = (this.occupiedCells[key] || 0) + 1;

            // Draw starting dot so there's no gap when the spiral begins
            this.ctx.fillStyle = car.color;
            this.ctx.beginPath();
            this.ctx.arc(gridX, gridY, this.lineWidth / 2, 0, Math.PI * 2);
            this.ctx.fill();

            this.cars.push(car);
            return;
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
                    // Found a free spot - spawn there even if it can't move
                    var car = new Car(gridX, gridY, this.canvas.width, this.canvas.height, this.hexSize, this.currentPhase);
                    car.prevX = gridX;
                    car.prevY = gridY;
                    this.occupiedCells[key] = (this.occupiedCells[key] || 0) + 1;

                    // Draw starting dot so there's no gap when the spiral begins
                    this.ctx.fillStyle = car.color;
                    this.ctx.beginPath();
                    this.ctx.arc(gridX, gridY, this.lineWidth / 2, 0, Math.PI * 2);
                    this.ctx.fill();

                    this.cars.push(car);
                    return;
                }
            }
        }
    }

    // Truly no free spots left - animation is complete
    this.animationComplete = true;
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
        self.allLines = [];
        self.currentPhase = 1;
        self.animationComplete = false;
        self.finalDotsDrawn = false;

        // Recalculate scale factor for new size
        var scaleFactor = Math.max(0.4, Math.min(1.2, window.innerWidth / 1400));
        self.phase1Config.hexSize = Math.round(100 * scaleFactor);
        self.phase1Config.lineWidth = Math.round(120 * scaleFactor);
        self.phase2Config.hexSize = Math.round(50 * scaleFactor);
        self.phase2Config.lineWidth = Math.round(25 * scaleFactor);

        // Set phase 1 config (restart from beginning)
        self.hexSize = self.phase1Config.hexSize;
        self.maxCars = self.phase1Config.maxCars;
        self.lineWidth = self.phase1Config.lineWidth;

        // Spawn new cars
        for (var i = 0; i < self.maxCars; i++) {
            self.spawnCar();
        }
    }, 500); // Longer debounce to avoid scroll triggers
};

CircuitBoard.prototype.animate = function() {
    this.animationId = requestAnimationFrame(this.animate.bind(this));
    this.draw();
};

CircuitBoard.prototype.draw = function() {
    // Fill remaining grid points with dots when complete
    if (this.animationComplete && this.cars.length === 0) {
        if (!this.finalDotsDrawn) {
            this.drawRemainingDots();
            this.finalDotsDrawn = true;

            // LAYERED EFFECT: Start Phase 2 after Phase 1 completes
            if (this.currentPhase === 1) {
                this.startPhase2();
            }
        }
        return;
    }

    var currentTime = Date.now();

    // Fade effect for trace trails (only if fadeAlpha > 0)
    if (this.fadeAlpha > 0) {
        this.ctx.fillStyle = 'rgba(240, 249, 255, ' + this.fadeAlpha + ')';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

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
                // No valid move found
                entry.car.stuck = true;
            }
        }

        // PHASE 4: Handle stuck cars
        for (var i = this.cars.length - 1; i >= 0; i--) {
            var car = this.cars[i];

            if (car.stuck) {
                // Draw a filled circle at stuck position before removing
                this.ctx.fillStyle = car.color;
                this.ctx.beginPath();
                this.ctx.arc(car.x, car.y, this.lineWidth / 2, 0, Math.PI * 2);
                this.ctx.fill();

                // Remove stuck car and spawn new one
                this.cars.splice(i, 1);
                if (this.cars.length < this.maxCars && !this.animationComplete) {
                    this.spawnCar();
                }
            }
        }

        // Aggressively spawn new cars to fill all gaps - always try to maintain max cars
        if (this.cars.length < this.maxCars && !this.animationComplete) {
            this.spawnCar();
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

CircuitBoard.prototype.calculateMove = function(car) {
    // Turn angle is measured RELATIVE to where the car came from
    // Straight ahead = continue in same direction as currentDirection
    var straightAhead = car.currentDirection;
    var priorities;

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

    var oldX = car.x;
    var oldY = car.y;

    car.x = snappedX;
    car.y = snappedY;
    car.previousDirection = car.currentDirection; // Track where we came from

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

    // Record line
    this.allLines.push({
        x1: oldX,
        y1: oldY,
        x2: car.x,
        y2: car.y
    });
};

CircuitBoard.prototype.startPhase2 = function() {
    // Switch to Phase 2 configuration (thin lines) without clearing canvas
    this.currentPhase = 2;
    this.hexSize = this.phase2Config.hexSize;
    this.maxCars = this.phase2Config.maxCars;
    this.lineWidth = this.phase2Config.lineWidth;

    // Reset state but keep canvas drawings
    this.cars = [];
    this.occupiedCells = {};
    this.allLines = [];
    this.animationComplete = false;
    this.finalDotsDrawn = false;

    // Spawn new cars with Phase 2 settings
    for (var i = 0; i < this.maxCars; i++) {
        this.spawnCar();
    }
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
                    var tempCar = new Car(gridX, gridY, this.canvas.width, this.canvas.height, this.hexSize, this.currentPhase);
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

initCircuitBoard();
