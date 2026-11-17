SELECT topic, clientid, username, publish_received_at AS broker_received_at_ms, payload
FROM "robot/amr01/commissioning"
WHERE username = 'publisher-amr01'
