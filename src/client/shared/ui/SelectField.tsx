import type { SelectHTMLAttributes } from "react";

export interface SelectOption {
  label: string;
  value: string;
}

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> {
  id: string;
  label: string;
  options: readonly SelectOption[];
  detail?: string;
}

export function SelectField({ id, label, options, detail, className = "", ...props }: SelectFieldProps) {
  const detailId = `${id}Detail`;
  return (
    <label className={`selectGroup ${className}`.trim()} htmlFor={id}>
      <span className="selectLabel">{label}</span>
      <select aria-describedby={detail ? detailId : undefined} className="selectField" id={id} {...props}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <span aria-hidden={!detail} className="selectDetail" id={detailId}>{detail ?? ""}</span>
    </label>
  );
}
