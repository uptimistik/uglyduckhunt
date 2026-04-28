# Air Mouse Controller Architecture

## Objective
Build a high-precision "Air Mouse" controller for a Phaser 3 Duck Hunt game. The system consists of a PC Browser (Game) and a Mobile Capacitor App (Controller).

## Core Requirements

### Sensor Fusion
Do NOT use raw deviceorientation values. Implement a Madgwick Filter or Mahony Filter to fuse Accelerometer and Gyroscope data into a stable Quaternion. This is critical for eliminating jitter and drift.

### Coordinate Mapping
Use Spherical-to-Cartesian projection. Map the phone's Pitch (Up/Down) and Yaw (Left/Right) onto a 1920x1080 coordinate plane.

### Recenter Function
When the trigger is held for 2 seconds, the current orientation becomes (0,0,0) (the center of the screen).

### Hardware Trigger
In the Capacitor mobile app, intercept the Physical Volume Buttons using native listeners. When pressed, emit a fire event to the PC via WebRTC / Colyseus WebSockets.

### Distance Enforcement Logic
Implement a calibration step where the user clicks the left edge and right edge of the monitor.
Calculate the Angular Delta (Δ Yaw).
If the Δ Yaw > 20°, the user is too close. Refuse to start the game and prompt them to step back until the angle is between 8° and 15°.

### Smoothing & Latency
On the Mobile side: Use a Low-Pass Filter (EMA) with an alpha of 0.2 on the output coordinates.
On the PC side: In the Phaser update() loop, use Linear Interpolation (Lerp) to move the crosshair to the target (X, Y) at a rate of 0.15 per frame to mask network latency.

## Output Structure
Provide the SensorManager class for the Capacitor app.
Provide the CalibrationManager logic for distance enforcement.
Provide the Phaser GameScene code for crosshair movement and hit detection.
