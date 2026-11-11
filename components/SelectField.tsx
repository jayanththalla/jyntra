"use client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface SelectOption {
  value: string;
  label: string;
}

/** Thin wrapper over the shadcn Select so call sites stay short: value + options + onChange. */
export function SelectField({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  disabled,
  id,
  size,
  ...aria
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  size?: "sm" | "default";
  "aria-label"?: string;
  title?: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger id={id} size={size} className={className} {...aria}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
