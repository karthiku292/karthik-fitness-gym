import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { exerciseImage, type Exercise } from "@/features/exercises/data";

/** Exercise photo with graceful fallback so links never appear broken. */
export function ExerciseImage({
  ex,
  frame = 0,
  className,
}: {
  ex: Exercise;
  frame?: 0 | 1;
  className?: string;
}) {
  const [src, setSrc] = useState(exerciseImage(ex, frame));
  const [usedFallback, setUsedFallback] = useState(false);

  // Reset when the exercise/frame changes.
  useEffect(() => {
    setSrc(exerciseImage(ex, frame));
    setUsedFallback(false);
  }, [ex, frame]);

  return (
    <img
      src={src}
      alt={ex.name}
      loading="lazy"
      onError={() => {
        if (!usedFallback) {
          setSrc(ex.fallback);
          setUsedFallback(true);
        }
      }}
      className={clsx("h-full w-full object-cover", className)}
    />
  );
}
