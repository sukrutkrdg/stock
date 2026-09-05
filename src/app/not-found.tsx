import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-8 text-center">
      <h1 className="text-[22px] font-bold">That slate is gone</h1>
      <p className="text-[14px] leading-snug text-muted">
        The link may be from a different deployment, or the slate was never saved.
      </p>
      <Link
        href="/create"
        className="inline-flex h-11 items-center rounded-xl bg-brand px-5 text-[15px] font-semibold text-white"
      >
        Build one instead
      </Link>
    </div>
  );
}
