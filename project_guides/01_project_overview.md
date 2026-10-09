# Project Overview

**Project:** Three-Robot Warehouse Replenishment Digital Twin  
**Owner:** S L RICHRIS  
**Purpose:** Educational use

## Problem and objective

Shelf stock can run out while robots wait for assignments. Sending multiple robots through a shared narrow aisle also requires coordination.

This project demonstrates how a human operator can inspect stock needs, approve replenishment missions and observe three coordinated virtual robots in an interactive warehouse.

## Implemented features

| Feature | Literal meaning |
|---|---|
| 3D warehouse | A visual model of shelves, the warehouse and three robots |
| Human approval | Proposed missions wait for an operator's approval |
| Shared-aisle scheduling | One simulated robot reserves the aisle for a complete delivery-and-return journey |
| Mission checks | Checks availability, duplicate shelf assignments and estimated return battery |
| Forecasts | Calculates future stock and battery values from defined model rates and approved journeys |
| Dark and bright themes | Two screen appearances |
| Motion preference | Interface animations can be reduced |
| Activity export | Saves operator decisions and simulation events as CSV |
| Three ESP32 slots | Receives and validates measurements from three configured devices |

## Software and its role

| Software | Role |
|---|---|
| Python and Streamlit | Starts and hosts the application |
| HTML and CSS | Dashboard contents, layout, colors and typography |
| JavaScript | Simulation, mission review and browser interactions |
| Three.js | Draws the 3D warehouse |
| MQTT.js | Receives device measurements through a configured broker |
| ESP32 Arduino starter | Publishes measurements over Wi-Fi |
| GitHub | Stores the source and supplies it to Streamlit |

## Scope and limitations

- Forecasts are deterministic calculations, not a trained machine-learning model.
- Simulation success does not prove collision avoidance or safety on physical robots.
- Physical position, speed, battery and state need measured sensors and integration. Unconfigured readings remain unknown.
- The warehouse is an illustrative coordinate model, not a surveyed laboratory map.
- The hardware connection receives measurements only.
- Camera streaming, a physical robot controller and the separate LabVIEW supervisor are not implemented by this repository.

Continue with [how the system works](02_how_the_digital_twin_works.md) and the [demonstration steps](03_demonstration_steps.md).

© 2026 S L RICHRIS. All rights reserved. Purely for educational purposes.
