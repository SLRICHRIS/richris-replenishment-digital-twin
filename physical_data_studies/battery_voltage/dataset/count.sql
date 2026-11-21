-- Count unique device packets and boots in the same physical snapshot.
SELECT count(*) AS packets,
       count(DISTINCT (s.robot_id, s.boot_id, s.seq)) AS unique_packets,
       count(DISTINCT s.boot_id) AS boots,
       count(s.battery_voltage_v) AS with_voltage,
       count(*) FILTER (WHERE s.gyro_available) AS with_gyro,
       count(*) FILTER (WHERE s.pwm_duty > 0) AS reported_nonzero_pwm,
       min(s.received_at) AS first_received,
       max(s.received_at) AS last_received
FROM public.amr_commissioning_samples AS s
WHERE s.robot_id = 'amr01'
  AND s.topic = 'robot/amr01/commissioning'
  AND s.message_type = 'mh_ir_commissioning'
  AND s.client_id = 'amr01-ir-' || s.boot_id
  AND s.received_at <= TIMESTAMPTZ '2026-11-21T19:21:37.463612Z'
  AND s.stored_at <= TIMESTAMPTZ '2026-11-21T19:21:37.463612Z';
