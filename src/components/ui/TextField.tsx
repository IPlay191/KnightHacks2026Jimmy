import { forwardRef, useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

interface FieldChrome {
  label: string;
  description?: string;
  error?: string | null;
}

const inputBase =
  "w-full rounded-md border bg-surface-raised px-3 py-2.5 text-text placeholder:text-text-muted transition-colors focus-visible:border-primary-soft";

/** Labelled text input with description and error wiring (R13.6, R16.10). */
export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FieldChrome>(
  function TextField({ label, description, error, id, className = "", ...rest }, ref) {
    const autoId = useId();
    const inputId = id ?? autoId;
    const descId = description ? `${inputId}-desc` : undefined;
    const errId = error ? `${inputId}-err` : undefined;
    return (
      <div className={`flex flex-col gap-1.5 ${className}`}>
        <label htmlFor={inputId} className="text-small text-text">
          {label}
        </label>
        {description ? (
          <p id={descId} className="text-caption text-text-muted">
            {description}
          </p>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={[descId, errId].filter(Boolean).join(" ") || undefined}
          className={`${inputBase} ${error ? "border-danger" : "border-border-strong"}`}
          {...rest}
        />
        {error ? (
          <p id={errId} className="text-small text-danger">
            {error}
          </p>
        ) : null}
      </div>
    );
  },
);

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & FieldChrome>(
  function TextArea({ label, description, error, id, className = "", ...rest }, ref) {
    const autoId = useId();
    const inputId = id ?? autoId;
    const descId = description ? `${inputId}-desc` : undefined;
    const errId = error ? `${inputId}-err` : undefined;
    return (
      <div className={`flex flex-col gap-1.5 ${className}`}>
        <label htmlFor={inputId} className="text-small text-text">
          {label}
        </label>
        {description ? (
          <p id={descId} className="text-caption text-text-muted">
            {description}
          </p>
        ) : null}
        <textarea
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={[descId, errId].filter(Boolean).join(" ") || undefined}
          className={`${inputBase} min-h-20 resize-y ${error ? "border-danger" : "border-border-strong"}`}
          {...rest}
        />
        {error ? (
          <p id={errId} className="text-small text-danger">
            {error}
          </p>
        ) : null}
      </div>
    );
  },
);
