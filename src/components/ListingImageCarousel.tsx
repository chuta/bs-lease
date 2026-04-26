import { useCallback, useEffect, useState } from "react";
import { fetchListingGallerySlides, type ListingGallerySlide } from "../lib/listingGalleryApi";

const SIGNED_URL_TTL_SEC = 60 * 30;
const FALLBACK_SRC = "/Untitled.jpg";
const FALLBACK_ALT = "BlockSpace property";

type Props = {
  className?: string;
  imageClassName?: string;
};

export function ListingImageCarousel({ className = "", imageClassName = "" }: Props) {
  const [slides, setSlides] = useState<ListingGallerySlide[] | null>(null);
  const [index, setIndex] = useState(0);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchListingGallerySlides(SIGNED_URL_TTL_SEC)
      .then((s) => {
        if (!cancelled) setSlides(s);
      })
      .catch(() => {
        if (!cancelled) setSlides([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const active = slides && slides.length > 0 ? slides[Math.min(index, slides.length - 1)] : null;
  const showCarousel = slides && slides.length > 0;

  const go = useCallback(
    (delta: number) => {
      if (!slides?.length) return;
      setIndex((i) => (i + delta + slides.length) % slides.length);
      setBroken(false);
    },
    [slides],
  );

  useEffect(() => {
    if (!showCarousel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, showCarousel]);

  if (slides === null) {
    return (
      <div
        className={`overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 ${className}`}
      >
        <div
          className={`flex h-48 items-center justify-center text-sm text-slate-500 md:h-72 ${imageClassName}`}
        >
          Loading photos…
        </div>
      </div>
    );
  }

  if (!showCarousel) {
    return (
      <div className={`overflow-hidden rounded-2xl border border-slate-200 bg-white ${className}`}>
        <img
          src={FALLBACK_SRC}
          alt={FALLBACK_ALT}
          className={`h-48 w-full object-cover md:h-72 ${imageClassName}`}
          loading="eager"
        />
      </div>
    );
  }

  const caption = active?.caption?.trim() || "Photo";

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-900 ${className}`}
      role="region"
      aria-roledescription="carousel"
      aria-label="Property photos"
    >
      {broken ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2 bg-slate-100 px-4 text-center text-sm text-slate-600 md:h-72">
          <span>This image could not be loaded.</span>
          <button
            type="button"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
            onClick={() => setBroken(false)}
          >
            Try again
          </button>
        </div>
      ) : (
        <img
          src={active?.signedUrl}
          alt={caption}
          className={`h-48 w-full object-cover md:h-72 ${imageClassName}`}
          loading={index === 0 ? "eager" : "lazy"}
          onError={() => setBroken(true)}
        />
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-3 pt-12 md:px-4 md:pb-4">
        <p className="pointer-events-none text-center text-sm font-medium text-white drop-shadow md:text-base">
          {caption}
        </p>
      </div>

      {slides.length > 1 ? (
        <>
          <button
            type="button"
            aria-label="Previous photo"
            className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full border border-white/30 bg-black/40 p-2 text-white backdrop-blur hover:bg-black/55 md:left-3"
            onClick={() => go(-1)}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Next photo"
            className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full border border-white/30 bg-black/40 p-2 text-white backdrop-blur hover:bg-black/55 md:right-3"
            onClick={() => go(1)}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <div className="absolute bottom-14 left-0 right-0 flex justify-center gap-1.5 md:bottom-16">
            {slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                aria-label={`Photo ${i + 1}`}
                aria-current={i === index}
                className={`h-2 w-2 rounded-full transition ${i === index ? "bg-white" : "bg-white/40 hover:bg-white/70"}`}
                onClick={() => {
                  setIndex(i);
                  setBroken(false);
                }}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function ChevronLeft({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
