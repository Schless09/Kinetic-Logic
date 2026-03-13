/**
 * Kinetic Trace: VLA (Vision-Language-Action) data format.
 * Syncs motion sensors to video frames for AI training.
 */

export interface KineticTraceMetadata {
  device: string;
  fps: number;
  sensor_hz: number;
}

export interface KineticTraceSensors {
  accel: { x: number; y: number; z: number };
  gyro: { x: number; y: number; z: number };
}

export interface KineticTraceSample {
  timestamp_ms: number;
  video_frame_id: number;
  audio_transcript?: string;
  sensors: KineticTraceSensors;
}

export interface KineticTrace {
  metadata: KineticTraceMetadata;
  samples: KineticTraceSample[];
}

/** Build a single sample (used by sensor engine). */
export function createKineticSample(
  timestamp_ms: number,
  video_frame_id: number,
  accel: { x: number; y: number; z: number },
  gyro: { x: number; y: number; z: number },
  audio_transcript?: string
): KineticTraceSample {
  return {
    timestamp_ms,
    video_frame_id,
    ...(audio_transcript !== undefined && { audio_transcript }),
    sensors: { accel, gyro },
  };
}

/** Build full KineticTrace for export (e.g. before upload). */
export function createKineticTrace(
  device: string,
  fps: number,
  sensor_hz: number,
  samples: KineticTraceSample[]
): KineticTrace {
  return {
    metadata: { device, fps, sensor_hz },
    samples,
  };
}
