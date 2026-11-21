# Live sensor recommendations and operator responses

AMR-01 sends measured channels through EMQX to the stored sensor pipeline. The
dashboard computes recommendations from the latest packet and up to 30 seconds
of recent history. **Live AMR mission → Direct Wi-Fi drive** places these checks
beside the existing ESP32 controller. **Sensor models → Review & decide** records
the operator's response and collects subsequent readings.

## Checks supported by the current sensors

| Area | Evidence checked | Suggested response |
| --- | --- | --- |
| Battery input | INA219 availability, sensor timestamp and voltage at or below 6.60 V | Stop, inspect the pack and connections, then check or recharge it |
| Voltage under load | At least 0.50 V drop from three preceding idle readings within five seconds | Inspect battery, connectors and motor load; a loaded reading at or below 6.60 V gets stop priority |
| Current and power | Current sign during reported output; near-zero current combined with no wheel pulses | Check sensor polarity/zero or the motor supply, common ground, STBY and leads |
| Charge accounting | Continuity gaps or a reported-start scenario outside 0–100% | Re-establish the measurement reference and check current sensing |
| Command delivery | A direction requested while reported output remains stopped | Stop and inspect the local controller response and interlocks |
| Missing rotation feedback | Reported output with no pulses from the expected moving wheel(s) | Stop and inspect wheel motion, obstructions and encoder wiring |
| One wheel channel | Straight-direction output with one side persistently at zero | Inspect that wheel, encoder alignment and channel assignment |
| Unequal wheel rates | At least 50% pulse-total difference with ten or more counted pulses per side | Check whether steering was intended; inspect loading, slip and counts |
| Pulses while stopped | Pulse activity while reported output is stopped and PWM is zero | Check hand movement, coasting, vibration and electrical noise |
| Gyro | Missing/stale IMU, missing startup bias, or corrected Z rate above 5°/s while outputs and pulse rates are zero | Confirm actual stillness and inspect mounting/calibration |
| Apparent tilt | Stable, gravity-like acceleration and low gyro rates, with apparent tilt at least 25° | Check whether the robot is level and the reported Z-up mounting is correct |
| Acceleration | Magnitude differs from gravity by more than 0.5 g over the sustained interval | Inspect actual motion and IMU mounting |
| Connection and continuity | Packet age, missing sequence positions and a reset motion origin | Restore forwarding and collect fresh evidence before interpreting estimates |

Sustained checks require at least five consecutive samples spanning two seconds.
A sequence gap, non-increasing device time or interval above 1.1 seconds resets
the continuous window. Duplicate, future and other-boot samples cannot extend it.
Voltage-sag comparisons retain recent loaded events after idle voltage recovers.

The settings in `sensor_recommendations.POLICY` are explicit engineering screening
settings. Except for reusing the existing 6.6 V remote-drive cutoff, they have not
been validated as equipment safety limits or learned fault probabilities. No
configured check firing means only that the available checks did not trigger.

## Available responses

| Dashboard response | How the operator applies it |
| --- | --- |
| Keep monitoring | Observe the attended trial and compare the next readings |
| Stop and inspect the AMR | Use Stop in the direct controller, then inspect the indicated part |
| Review a lower motor-power setting | Stop first, select a previously verified lower setting and make a brief attended check |
| Check / recharge battery | Stop, disconnect motor power and inspect the pack/connections before charging |
| Inspect the motor-power path | With motor power off, check supply, connectors, common ground, enable wiring and leads |
| Inspect wheels and encoder feedback | Isolate motor power, then inspect wheel obstruction and encoder alignment/wiring |
| Check IMU mounting and gyro calibration | Keep the AMR still and level while checking mounting and startup calibration |
| Restore the sensor connection | Check power, hotspot and forwarding; wait for fresh packets |
| Inspect the AMR / sensors | Compare the affected readings with an independent physical observation |

Selecting **Review: …** opens the existing protected review panel and suggests
the response. The operator still captures fresh evidence, chooses a response,
enters a reason and records the decision. Opening a recommendation never captures
or approves it automatically. A change in recommendation category, priority,
suggested action, boot, commissioning settings or screening policy requires a
new review. Small numeric variation within the same category does not.

**Open Drive control** opens the native ESP32 page at `10.15.213.112` and carries
the saved response's instructions into the drive view. The operator applies it
using the local controls or performs the physical task. This installed receiver
does not expose a dashboard approval/acknowledgement API. Recording an observation
decision therefore sends no motor command; loading its page is not a device ACK.
There is no queued command or automatic resume. EMQX remains the sensor transport.

The audit records three distinct, fresh, later sensor readings. They are follow-up
observations after the decision, not proof that charging, inspection or a motor
change occurred. To review the result after a longer physical task, capture a new
review when fresh readings resume. Detailed controls and the 700 ms device hold
timeout are covered in [direct Wi-Fi setup](manual_motor_control_setup.md).

## Freshness and inference boundaries

The browser removes current findings after five seconds without fresh evidence,
even if backend updates stop. Demo data cannot create live physical findings.
The system shows six coverage areas so missing sensors remain visible.

The INA219 measures the motor branch. An assumed 100% starting charge and reported
2.2 Ah pack do not establish actual remaining charge or whole-robot runtime.
Single-channel encoder magnitudes and GPIO output reports do not establish travel
direction, ground distance or arrival. Sampled acceleration cannot detect every
brief impact or resolve vibration frequency. The installed sensors do not measure
motor temperature or obstacles, and no validated motor overcurrent limit is
configured. Camera routes keep their separate localisation and commissioning
requirements.

Synthetic timeline tests exercise each rule without inserting records into the
physical database or commanding the AMR. Browser checks cover stale expiry,
response selection, source isolation, preserved drafts and the manual handoff.
