import React from 'react';

interface InputGroupProps {
  label: string;
  value: number | string;
  onChange: (val: string) => void;
  type?: string;
  placeholder?: string;
  icon?: React.ReactNode;
  step?: string;
  unit?: string;
}

export const InputGroup: React.FC<InputGroupProps> = ({
  label,
  value,
  onChange,
  type = "number",
  placeholder,
  icon,
  step = "0.01",
  unit
}) => {
  return (
    <div className="flex flex-col space-y-2 w-full">
      <label className="text-xs text-slate-400 font-medium ml-1">{label}</label>
      <div className="relative flex items-center">
        {/* Input container matching the screenshot style: Dark bg, rounded, inner shadow feel */}
        <input
          type={type}
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-app-input border border-app-border text-slate-100 rounded-lg py-3 px-4 focus:outline-none focus:border-brand-yellow/50 focus:ring-1 focus:ring-brand-yellow/50 transition-all font-mono text-lg placeholder-slate-700"
        />
        
        {/* Right side controls/units */}
        <div className="absolute right-0 inset-y-0 flex items-center pr-3 space-x-2 pointer-events-none">
           {unit && <span className="text-slate-500 text-xs font-bold">{unit}</span>}
        </div>
      </div>
    </div>
  );
};