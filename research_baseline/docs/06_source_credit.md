# 06. Paper credit and research scope

## Full primary reference

Ferrari, A., Carlin, A., Rafele, C., & Zenezini, G. (2024). **A method for developing and validating simulation models for automated storage and retrieval system digital twins.** *The International Journal of Advanced Manufacturing Technology*, 131, 5369-5382. DOI: https://doi.org/10.1007/s00170-023-12660-y

Published online in 2023 and included in the 2024 volume.

## Contributions of Ferrari et al. used as methodological motivation

1. Represent physical storage equipment and the associated warehouse information/control architecture rather than modelling material movement in isolation.
2. Use a discrete-event simulation with explicit operation states and timing assumptions.
3. Validate predicted storage-operation times against physical experiments and refine the model through calibration.

These are methodological foundations. The published study primarily addressed storage operations in a laboratory AS/RS and did not implement the identical Python application, inventory workflow, data model or web interface shipped here.

## Independent work and limits

The present repository contains a synthetic 2D warehouse graph, one simulated resource, fictitious SKU quantities and demand schedules, a FIFO-vs-urgency comparator, REST services, SQLite persistence and a Streamlit research view. These were prepared for this research project. No original Ferrari figures, images, datasets, proprietary equipment model or source code are included. The repository does not claim endorsement by Ferrari or its authors.

## How to acknowledge in reports

"The research prototype adopts the integrated architecture and simulation-validation principles discussed by Ferrari et al. (2024). Our replenishment workflow and implementation are independent and have not yet undergone equivalent physical validation."

## Citation locations to consult

- Ferrari et al., Section 2.3: research gap and contribution.
- Section 4.1: physical system and information-system UML architecture.
- Section 4.2: discrete-event simulation and travel-time model.
- Section 5: design of experiments, calibration and validation.
- Section 6: conclusions and remaining scope.

For precise printed page and figure locations, consult the original PDF, not reconstructed graphics from presentations.
