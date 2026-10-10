import Link from "next/link";
import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-[background-color,box-shadow,color,transform] duration-200 ease-standard disabled:cursor-not-allowed disabled:opacity-60 select-none";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:shadow-glow-primary active:translate-y-px",
  secondary:
    "bg-surface-raised text-text border border-border-strong hover:bg-surface hover:border-primary-soft active:translate-y-px",
  ghost: "bg-transparent text-text-secondary hover:bg-surface-raised hover:text-text",
  destructive: "bg-record text-on-record hover:shadow-glow-record active:translate-y-px",
};

// Every size is at least 24×24 CSS px (WCAG 2.5.8, R16.9).
const sizes: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3 text-small",
  md: "min-h-11 px-5 text-base",
  lg: "min-h-13 px-7 text-body-l",
};

export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra = ""): string {
  return `${base} ${variants[variant]} ${sizes[size]} ${extra}`.trim();
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", icon, className = "", children, type = "button", ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={buttonClasses(variant, size, className)} {...rest}>
      {icon ? (
        <span aria-hidden="true" className="inline-flex">
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  );
});

export interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
}

export function ButtonLink({ href, variant = "primary", size = "md", icon, className = "", children, ...rest }: ButtonLinkProps) {
  return (
    <Link href={href} className={buttonClasses(variant, size, className)} {...rest}>
      {icon ? (
        <span aria-hidden="true" className="inline-flex">
          {icon}
        </span>
      ) : null}
      {children}
    </Link>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required accessible name for icon-only buttons (R16.4). */
  "aria-label": string;
  variant?: ButtonVariant;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = "ghost", className = "", children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`${base} ${variants[variant]} size-10 min-h-10 rounded-md p-0 ${className}`}
      {...rest}
    >
      <span aria-hidden="true" className="inline-flex">
        {children}
      </span>
    </button>
  );
});
