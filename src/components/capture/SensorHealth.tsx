"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface SensorHealthProps {
  lastEventAt: number | null;
  isCapturing: boolean;
  sampleCount: number;
  className?: string;
}

const SPARK_COUNT = 12;
const STALE_MS = 150;

/**
 * Real-time "sensor health" sparks: show live activity when events are recent.
 */
export function SensorHealth({
  lastEventAt,
  isCapturing,
  sampleCount,
  className,
}: SensorHealthProps) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!isCapturing) return;
    const id = setInterval(() => setTick((t) => t + 1), 80);
    return () => clearInterval(id);
  }, [isCapturing]);

  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  const isLive = lastEventAt != null && now - lastEventAt < STALE_MS;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center gap-1.5">
        {Array.from({ length: SPARK_COUNT }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 w-1.5 rounded-full transition-colors duration-75",
              isCapturing && isLive
                ? "bg-emerald-500 shadow-[0_0_6px_var(--emerald-500)]"
                : isCapturing
                  ? "bg-muted-foreground/30"
                  : "bg-muted-foreground/20"
            )}
            style={
              isCapturing && isLive
                ? { animation: `pulse 0.5s ease-in-out ${i * 0.05}s infinite` }
                : undefined
            }
          />
        ))}
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">
        {isCapturing ? `${sampleCount} samples` : "Sensors idle"}
      </span>
    </div>
  );
}
