"""Run the browser camera and route coordinator together on the Streamlit host.

Only signed ESP32 feedback and expiring drive packets cross the MQTT broker.
The coordinator and camera share a reentrant lock for local signed requests,
so a callback cannot deadlock against a simultaneous operator decision.
"""
import time

from .browser_gateway import BrowserVisionGateway, MAX_FRAME_AGE_MS
from .contracts import DRIVE_TOPIC, HARDWARE_TOPIC, MAX_PWM, fresh, seal
from .protocol import hardware
from .service import Service


class BrowserReceiverService(Service):
    topics = (HARDWARE_TOPIC,)
    client_label = 'browser-receiver'

    def __init__(self, profile):
        self._route = profile
        self._feedback = None
        self._generation = 0
        self._camera = None
        super().__init__(profile)

    def disconnected(self):
        with self.guard:
            super().disconnected()
            self._generation += 1
            self._feedback = None

    def message(self, client, userdata, message):
        if message.topic != HARDWARE_TOPIC or message.retain:
            return
        with self.guard:
            if not self.connected or self.stop.is_set():
                return
            try:
                packet = hardware(message.payload, self._route['drive_key'], int(time.time() * 1000),
                                  max_pwm=255, allow_manual=True)
            except (ValueError, TypeError, UnicodeError):
                return
            previous = self._feedback
            if previous:
                same_boot = (packet['boot_id'], packet['epoch_id']) == (previous['boot_id'], previous['epoch_id'])
                if packet['issued_at_ms'] < previous['issued_at_ms'] or (same_boot and packet['seq'] <= previous['seq']):
                    return
            self._feedback = packet

    def public_transport(self):
        with self.guard:
            result = dict(super().public_transport(), feedback_topic='hardware', receiver=None)
            packet = self._feedback
            if packet:
                now = int(time.time() * 1000)
                result['receiver'] = {k: packet[k] for k in ('protocol', 'ready', 'state', 'battery_voltage_v', 'boot_id', 'epoch_id', 'seq', 'issued_at_ms')}
                result['receiver'].update(fresh=self.connected and fresh(packet['issued_at_ms'], now),
                                          age_ms=max(0, now - packet['issued_at_ms']))
            return result

    def route_hardware(self):
        with self.guard:
            packet = self._feedback
            if (self.connected and packet and packet['protocol'] == 'H1'
                    and max(abs(packet['left_duty']), abs(packet['right_duty'])) <= MAX_PWM
                    and fresh(packet['issued_at_ms'], int(time.time() * 1000))):
                return dict(packet)
            return None

    def camera_owned_by(self, owner):
        with self.coordinator.lock:
            camera = self._camera
            return bool(camera and camera.owner == owner and camera._session_active())

    def attach_camera(self, config, owner):
        with self.coordinator.lock, self.guard:
            if self._route.get('commissioned') is not True:
                raise ValueError('Complete physical commissioning and browser latency checks first')
            if self.stop.is_set() or not self.connected:
                raise ValueError('Wait for the ESP32 feedback subscription before connecting the camera')
            if self._camera is not None and self._camera._session_active():
                raise ValueError('A browser camera already owns this receiver connection')
            self.assert_owner()
            camera = _ReceiverCamera(config, self, owner, self._generation)
            self._camera = camera
            camera._start_watchdog()
            return camera

    def publish(self, packet):
        # Coordinator calls this only after committing the review. Revalidate
        # database ownership before each local request and lease renewal.
        with self.coordinator.lock:
            camera, row = self._camera, self.coordinator.row
            if not row or not self.camera_owned_by(row['owner_id']):
                raise ValueError('The reviewing operator must own the connected browser camera')
            with self.guard:
                self.assert_owner()
            now = camera._now()
            if packet['body']['operation'] != 'cancel' and now - camera.last_video_ms > MAX_FRAME_AGE_MS:
                raise ValueError('No fresh browser video for this request')
            camera.agent.request(packet, now)


class _ReceiverCamera(BrowserVisionGateway):
    def __init__(self, config, service, owner, generation):
        self.service, self.owner, self.generation = service, owner, generation
        self._initialize_camera(config, service._route, {'drive_key': service._route['drive_key']},
                                service.coordinator.lock)
        self.connected = self.subscribed = True

    def _session_active(self):
        service = self.service
        with service.guard:
            return (not self.closed and service._camera is self and service.connected
                    and not service.stop.is_set() and self.generation == service._generation)

    def _hardware(self):
        return self.service.route_hardware() if self._session_active() else None

    def _report_scene(self, observation, now):
        if self._session_active():
            self.service.coordinator.observe(seal('scene', observation, self.route['control_key']))
            self.service.coordinator.status(self.agent.status(now))

    def _publish_drive(self, packet):
        service = self.service
        with service.guard:
            if not self._session_active():
                raise ValueError('The protected ESP32 connection has ended')
            result = service.client.publish(DRIVE_TOPIC, packet, qos=0, retain=False)
            if result.rc != 0:
                raise ValueError('The protected ESP32 command could not be published')

    def _close_transport(self):
        with self.service.coordinator.lock:
            if self.service._camera is self:
                self.service._camera = None
