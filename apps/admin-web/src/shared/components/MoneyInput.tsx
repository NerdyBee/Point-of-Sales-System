import type { InputHTMLAttributes } from "react";
import { fromMajorUnits, moneyDecimals, toMajorUnits } from "../utils/money";

type MoneyInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange" | "min" | "max" | "step"> & {
  /** Stored amount (smallest unit), as everywhere else in the app. */
  value: number | "";
  onChange(amount: number): void;
  min?: number;
  max?: number;
};

/**
 * Number input for money. People type 4.99; `value`, `onChange`, `min` and `max` use the
 * stored amount (499 when the business has 2 decimal places).
 */
export function MoneyInput({ value, onChange, min, max, ...rest }: MoneyInputProps) {
  const decimals = moneyDecimals();
  return (
    <input
      {...rest}
      type="number"
      inputMode={decimals ? "decimal" : "numeric"}
      step={decimals ? 1 / 10 ** decimals : 1}
      min={min === undefined ? undefined : toMajorUnits(min)}
      max={max === undefined ? undefined : toMajorUnits(max)}
      value={value === "" ? "" : toMajorUnits(value)}
      onChange={(event) => onChange(event.target.value === "" ? 0 : fromMajorUnits(Number(event.target.value)))}
    />
  );
}
