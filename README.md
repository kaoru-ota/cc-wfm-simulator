# WFM Training Simulator

A browser-based workforce management training tool for lean contact center teams.

The simulator helps supervisors and WFM analysts practice a core operating skill: **do not chase short-term noise; read the demand trend, decide early, and execute with discipline.**

It models a 9-hour contact center day with changing demand, staffing lead time, service-level targets, occupancy pressure, and the operational consequences of overreacting to every dashboard movement.

<img width="1280" height="720" alt="wfm-training-simulator" src="https://github.com/user-attachments/assets/cfc08353-a32c-4f32-a8e1-d39b80f1fbb6" />


## Live Demo

Open the simulator here:

https://kaoru-ota.github.io/cc-wfm-simulator/

No sign-up or installation is required.

## GitHub Repository Setup

Suggested repository description:

> Browser-based WFM training simulator for lean contact center teams.

Suggested topics:

```text
contact-center
wfm
workforce-management
service-level
erlang-c
erlang-x
simulation
training
operations
vanilla-javascript
```

## What It Teaches

Small teams behave differently from large floors. When each agent represents a visible share of capacity, ordinary random variation can look like a signal worth acting on.

This simulator is designed to help learners experience the difference between:

- **Reactive management** — changing staffing whenever service level, queue, or occupancy moves
- **Strategic management** — using the forecast and the broader demand pattern to decide ahead of pressure, then avoiding unnecessary reversals

The main lesson is simple:

> In lean teams, good WFM is less about reacting faster to every metric change and more about recognizing the underlying pattern, deciding before the pressure arrives, and executing with discipline.

## Features

- **9-hour simulated operating day**
- **Demand phases** including opening, lunch rotation, afternoon dip, evening surge, and closing
- **Staffing controls** with add / reduce decisions
- **10-minute staffing lead time**
- **Erlang C and Erlang X+ forecast views**
- **Service level and occupancy targets**
- **AHT penalties** when occupancy moves outside the target range
- **Redial behavior** for abandoned contacts
- **Batch lunches and breaks** to model simultaneous off-phone time
- **Browser-only implementation** with no external runtime dependencies

## Training Use Case

The simulator can be used in a short workshop for new supervisors or WFM analysts:

1. **Run reactively** without relying on the forecast  
   Experience how repeated short-term adjustments can destabilize a small team.
2. **Run strategically** using the forecast and expected demand pattern  
   Compare the result against the reactive run.
3. **Debrief the difference**  
   Discuss where the real operation is reacting to noise rather than managing the underlying trend.

The tool is especially useful for conversations about:

- signal vs. noise in real-time metrics
- staffing lead time
- phase-aware decision-making
- service level vs. occupancy trade-offs
- the operating habits required in smaller, higher-skill teams

## How to Run Locally

This project is a standalone HTML application.

1. Clone the repository
2. Open `index.html` in a browser

No build step is required.

## Project Structure

```text
.
├── index.html          # Main standalone simulator
└── src/
    └── erlang.js       # Erlang-related reference implementation only
```

## Technical Notes

- Front end: HTML, CSS, and vanilla JavaScript
- Simulation loop: `requestAnimationFrame`
- Queueing models: Erlang C and Erlang X+
- Forecasting logic and simulation behavior are implemented client-side in `index.html`
- `index.html` is self-contained for GitHub Pages deployment; it does not load `src/erlang.js` at runtime

## Status

This project is currently maintained as an educational tool and article companion for contact center WFM training.

## Author

**Kaoru Ota**  
Contact center operations and analytics professional with experience across both small specialist teams and large multi-site environments.
