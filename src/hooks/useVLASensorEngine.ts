"use client";

import { useCallback, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Motion } from "@capacitor/motion";
import type { PluginListenerHandle } from "@capacitor/core";
import type { KineticTraceSample } from "@/types/kinetic-trace";
import { createKineticSample } from "@/types/kinetic-trace";

const SENSOR_HZ = 50;
const MIN_INTERVAL_MS = 1000 / SENSOR_HZ; // 20ms

function isNativeCapacitor(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export interface VLASensorEngineOptions {
  fps: number;
  sensor_hz?: number;
}

export interface VLASensorEngineResult {
  startCapture: () => Promise<void>;
  stopCapture: () => Promise<KineticTraceSample[]>;
  getSamples: () => KineticTraceSample[];
  isCapturing: boolean;
  /** Timestamp of last sensor event (for UI health indicator). */
  lastEventAt: number | null;
  /** Sample count in current buffer (for UI). */
  sampleCount: number;
}

/**
 * VLA Sensor Engine: buffers Accel/Gyro at 50Hz in a Ref to avoid re-renders,
 * syncing timestamps with video start trigger.
 */
export function useVLASensorEngine(
  options: VLASensorEngineOptions
): VLASensorEngineResult {
  const { fps, sensor_hz = SENSOR_HZ } = options;

  const [isCapturing, setIsCapturing] = useState(false);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const [sampleCount, setSampleCount] = useState(0);

  const handleRef = useRef<PluginListenerHandle | null>(null);
  const samplesRef = useRef<KineticTraceSample[]>([]);
  const captureStartTimeRef = useRef<number | null>(null);
  const lastPushedAtRef = useRef<number>(0);

  const pushSample = useCallback(
    (now: number, accel: { x: number; y: number; z: number }, gyro: { x: number; y: number; z: number }) => {
      const start = captureStartTimeRef.current;
      if (start == null) return;
      const elapsed = now - lastPushedAtRef.current;
      if (elapsed < MIN_INTERVAL_MS) return;
      lastPushedAtRef.current = now;
      const timestamp_ms = Math.round(now - start);
      const video_frame_id = Math.floor((timestamp_ms / 1000) * fps);
      const sample = createKineticSample(timestamp_ms, video_frame_id, accel, gyro);
      samplesRef.current.push(sample);
      setSampleCount(samplesRef.current.length);
    },
    [fps]
  );

  const startCapture = useCallback(async () => {
    if (handleRef.current) return;
    const startTime = typeof performance !== "undefined" ? performance.now() : Date.now();
    captureStartTimeRef.current = startTime;
    samplesRef.current = [];
    lastPushedAtRef.current = 0;
    setSampleCount(0);
    setLastEventAt(null);
    setIsCapturing(true);

    if (isNativeCapacitor()) {
      const handle = await Motion.addListener("accel", (event) => {
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        setLastEventAt(now);
        const accel = event.acceleration ?? event.accelerationIncludingGravity;
        const rot = event.rotationRate ?? { alpha: 0, beta: 0, gamma: 0 };
        pushSample(
          now,
          { x: accel.x ?? 0, y: accel.y ?? 0, z: accel.z ?? 0 },
          { x: rot.beta ?? 0, y: rot.gamma ?? 0, z: rot.alpha ?? 0 }
        );
      });
      handleRef.current = handle;
      return;
    }

    // Browser fallback: DeviceMotionEvent (may require user gesture + permission on iOS)
    const handler = (e: DeviceMotionEvent) => {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      setLastEventAt(now);
      const a = e.accelerationIncludingGravity ?? e.acceleration ?? { x: 0, y: 0, z: 0 };
      const r = e.rotationRate ?? { alpha: 0, beta: 0, gamma: 0 };
      pushSample(
        now,
        { x: a.x ?? 0, y: a.y ?? 0, z: a.z ?? 0 },
        { x: r.beta ?? 0, y: r.gamma ?? 0, z: r.alpha ?? 0 }
      );
    };
    if (typeof (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission === "function") {
      const perm = await (DeviceMotionEvent as unknown as { requestPermission: () => Promise<string> }).requestPermission();
      if (perm !== "granted") {
        setIsCapturing(false);
        return;
      }
    }
    window.addEventListener("devicemotion", handler);
    handleRef.current = { remove: () => window.removeEventListener("devicemotion", handler) } as PluginListenerHandle;
  }, [pushSample]);

  const stopCapture = useCallback(async (): Promise<KineticTraceSample[]> => {
    const h = handleRef.current;
    handleRef.current = null;
    if (h) {
      await h.remove();
    }
    captureStartTimeRef.current = null;
    setIsCapturing(false);
    const out = [...samplesRef.current];
    samplesRef.current = [];
    setSampleCount(0);
    return out;
  }, []);

  const getSamples = useCallback((): KineticTraceSample[] => {
    return [...samplesRef.current];
  }, []);

  return {
    startCapture,
    stopCapture,
    getSamples,
    isCapturing,
    lastEventAt,
    sampleCount,
  };
}
