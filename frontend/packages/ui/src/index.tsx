import type { ButtonHTMLAttributes, ReactNode, HTMLAttributes } from "react";
export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  return <button className={`button button--${variant} ${className}`} {...props} />;
}
export function Card({ className = "", ...props }: HTMLAttributes<HTMLElement>) { return <section className={`card ${className}`} {...props} />; }
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" }) { return <span className={`badge badge--${tone}`}>{children}</span>; }
export function Metric({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) { return <div className="metric"><span className="metric__label">{label}</span><strong className="metric__value">{value}</strong>{detail && <span className="metric__detail">{detail}</span>}</div>; }
export function Empty({ children }: {children: ReactNode}) { return <div className="empty" role="status">{children}</div>; }
