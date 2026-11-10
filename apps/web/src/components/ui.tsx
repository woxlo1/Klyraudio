import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { Loader2 } from "lucide-react";
import { classNames } from "../lib/format";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={classNames("btn", `btn--${variant}`, size === "sm" && "btn--sm", className)}
      disabled={disabled || loading}
    >
      {loading ? <Loader2 size={15} className="spin" aria-hidden="true" /> : icon}
      {children ? <span>{children}</span> : null}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: "sm" | "md";
  active?: boolean;
}

export function IconButton({
  label,
  size = "md",
  active = false,
  className,
  children,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      title={label}
      className={classNames(
        "icon-button",
        size === "sm" && "icon-button--small",
        active && "is-active",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Panel({
  title,
  subtitle,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={classNames("panel", className)}>
      {title || action ? (
        <header className="panel__header">
          <div>
            {title ? <h2 className="panel__title">{title}</h2> : null}
            {subtitle ? <p className="panel__subtitle">{subtitle}</p> : null}
          </div>
          {action ? <div className="panel__action">{action}</div> : null}
        </header>
      ) : null}
      <div className={classNames("panel__body", bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  optional,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  optional?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={classNames("field", className)}>
      <div className="field__top">
        <label className="field__label" htmlFor={htmlFor}>
          {label}
        </label>
        {optional ? <span className="field__optional">{optional}</span> : null}
      </div>
      {children}
      {hint ? <p className="field__hint">{hint}</p> : null}
      {error ? <p className="field__error">{error}</p> : null}
    </div>
  );
}

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={classNames("input", className)} />;
}

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} className={classNames("select", className)} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={classNames("textarea", className)} />;
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={classNames("switch-row", disabled && "is-disabled")}>
      <span className="switch-row__text">
        <span className="switch-row__label">{label}</span>
        {description ? <span className="switch-row__description">{description}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={typeof label === "string" ? label : undefined}
        className={classNames("switch", checked && "is-on")}
        onClick={() => onChange(!checked)}
        disabled={disabled}
      >
        <span className="switch__thumb" />
      </button>
    </label>
  );
}

export function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  disabled,
  id,
}: {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <div className="range-field">
      <div className="range-field__top">
        <label className="field__label" htmlFor={id}>
          {label}
        </label>
        <output className="range-field__value">{format ? format(value) : value}</output>
      </div>
      <input
        id={id}
        type="range"
        className="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

export function ProgressBar({
  value,
  label,
  tone = "accent",
}: {
  value: number | null;
  label?: ReactNode;
  tone?: "accent" | "success" | "danger";
}) {
  const indeterminate = value === null;
  return (
    <div className="progress-wrap">
      {label ? <div className="progress-label">{label}</div> : null}
      <div
        className={classNames("progress", indeterminate && "is-indeterminate", `progress--${tone}`)}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : Math.round((value ?? 0) * 100)}
      >
        <span
          className="progress__bar"
          style={
            indeterminate ? undefined : { width: `${Math.max(0, Math.min(1, value ?? 0)) * 100}%` }
          }
        />
      </div>
    </div>
  );
}

type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return <span className={classNames("badge", `badge--${tone}`, className)}>{children}</span>;
}

export function Spinner({ size = 18 }: { size?: number }) {
  return <Loader2 size={size} className="spin" aria-hidden="true" />;
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  compact,
}: {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={classNames("empty", compact && "empty--compact")}>
      {icon ? <div className="empty__icon">{icon}</div> : null}
      <h3>{title}</h3>
      {body ? <p>{body}</p> : null}
      {action ? <div className="empty__action">{action}</div> : null}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode }>;
  onChange: (value: T) => void;
  label?: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={classNames("segmented__item", option.value === value && "is-active")}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function InlineNotice({
  tone = "info",
  icon,
  children,
}: {
  tone?: "info" | "warning" | "danger" | "success";
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={classNames("notice", `notice--${tone}`)}
      role={tone === "danger" ? "alert" : undefined}
    >
      {icon ? <span className="notice__icon">{icon}</span> : null}
      <div className="notice__body">{children}</div>
    </div>
  );
}
