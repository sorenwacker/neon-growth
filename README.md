# Neon Growth

An evolutionary hexagonal grid animation where autonomous agents learn optimal pathfinding strategies through natural selection.

## 🎮 [Live Demo](https://sorenwacker.github.io/neon-growth/)

## Features

- **Evolutionary Learning**: Agents use genetic algorithms to evolve better movement strategies
- **Four Movement Strategies**: Wall-follower, Wanderer, Explorer, and Spiral
- **Fitness-Based Selection**: Strategies are selected based on lifetime, distance traveled, and cells explored
- **Dynamic Color System**:
  - Time-based global color shifts
  - Per-agent unique color palettes
  - Flowing gradient effects along paths
  - Position-dependent hue variations
- **Configurable Parameters**:
  - Hex grid size
  - Number of simultaneous agents
  - Trace lifetime (full brightness duration)
  - Fade duration (fade-out speed)
  - Line width
  - Animation speed
  - Mutation rate (exploration vs exploitation)

## How It Works

### Movement Strategies

1. **Wall-follower**: Prefers turning in one consistent direction (left or right)
2. **Wanderer**: Strongly prefers going straight with occasional random turns
3. **Explorer**: Randomizes direction priorities to explore widely
4. **Spiral**: Always attempts to turn in preferred direction to create tight spirals

### Evolutionary Algorithm

- Each agent's performance is tracked based on:
  - **Lifetime**: How long it survives before getting stuck
  - **Distance**: Total distance traveled
  - **Cells visited**: Number of unique grid positions explored

- When spawning new agents:
  - 90% probability: Select strategy based on fitness (survival of the fittest)
  - 10% probability: Random mutation (try new strategies)

- Agents can adapt during their lifetime by switching turning preferences when forced to turn opposite to their preference

### Color System

- **Global time drift**: All traces shift color together over time
- **Lifetime drift**: Colors evolve based on agent age
- **Flowing effect**: Colors propagate along paths like liquid flowing through tubes
- **Age-based fading**: Traces stay at full brightness during lifetime, then fade linearly to black

## Usage

Open `index.html` in a browser to see the animation with interactive controls.

### Controls

- **Hex Size**: Grid spacing in pixels (5-200px)
- **Max Agents**: Number of simultaneous agents (1-50)
- **Trace Lifetime**: How long traces stay visible at full brightness (0.5-10s)
- **Fade Duration**: How long traces take to fade to black (0.1-5s)
- **Line Width**: Thickness of drawn paths (1-150px)
- **Step Delay**: Milliseconds between movement steps (10-500ms)
- **Spawn Delay**: Milliseconds between spawning new agents (0-2000ms)
- **Mutation Rate**: Percentage of random strategy selection (0-50%)

## Technical Details

- **Grid System**: Hexagonal grid with offset rows
- **Collision Detection**: Prevents line crossing and grid point reuse
- **Rendering**: Canvas 2D with full redraw each frame for accurate color animations
- **Color Space**: HSL for smooth hue transitions
- **Performance**: Optimized with batched drawing and throttled cleanup

## Files

- `index.html`: Interactive visualization with controls
- `js/circuit-board.js`: Main animation engine

## License

MIT
