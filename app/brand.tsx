import Link from "next/link";

export function FantasyMark({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
    <defs>
      <linearGradient id="fantasy-portal" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
        <stop stopColor="#55F5FF" />
        <stop offset="1" stopColor="#A46CFF" />
      </linearGradient>
    </defs>
    <path d="M32 4 54 17v30L32 60 10 47V17L32 4Z" fill="none" stroke="url(#fantasy-portal)" strokeWidth="3" />
    <path d="M24 17h21l-3.4 7.5H32v7h8.2L37 39h-5v11h-8V17Z" fill="url(#fantasy-portal)" />
    <path d="m47 12-5 10 10-4-6 9 12-1" fill="none" stroke="#9A7CFF" strokeLinecap="round" strokeWidth="2" />
  </svg>;
}

export function Brand({ href }: { href?: string }) {
  const body = <><FantasyMark className="brand-logo" /><span className="brand-word"><b>幻界</b><small>FANTASY</small></span></>;
  return href ? <Link className="brand" href={href}>{body}</Link> : <div className="brand">{body}</div>;
}
