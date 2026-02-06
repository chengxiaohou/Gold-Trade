import React, { useRef, useEffect } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';

interface InputGroupProps {
  label: string;
  value: number | string;
  onChange: (val: string) => void;
  type?: string;
  placeholder?: string;
  icon?: React.ReactNode;
  step?: number;
  unit?: string;
}

export const InputGroup: React.FC<InputGroupProps> = ({
  label,
  value,
  onChange,
  type = "number",
  placeholder,
  icon,
  step = 0.01,
  unit
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const updateValue = (delta: number) => {
    const currentVal = parseFloat(value.toString()) || 0;
    // Calculate new value handling floating point errors
    const nextVal = Math.round((currentVal + delta) * 100) / 100;
    // Format: if result is integer, no decimals, otherwise up to 2 decimals
    const nextStr = Number.isInteger(nextVal) ? nextVal.toString() : nextVal.toFixed(2);
    onChange(nextStr);
  };

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      // Prevent default page scroll when hovering the input
      e.preventDefault();
      
      // Determine direction: deltaY > 0 is scrolling down (decrease), < 0 is scrolling up (increase)
      // Note: This matches standard UI behavior where pulling wheel down decreases value
      const direction = e.deltaY > 0 ? -1 : 1;
      updateValue(direction * step);
    };

    // Use non-passive listener to allow preventDefault()
    el.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, [value, step, onChange]); // Re-bind if these change

  return (
    <div className="flex flex-col space-y-1.5 w-full group/input">
      <label className="text-[10px] text-slate-400 font-medium ml-1 truncate">{label}</label>
      <div className="relative flex items-center">
        {/* 
           Using 'appearance-none' and custom CSS to hide default spin buttons 
           while keeping the number functionality.
        */}
        <style>{`
          .no-spinners::-webkit-inner-spin-button,
          .no-spinners::-webkit-outer-spin-button {
            -webkit-appearance: none;
            margin: 0;
          }
          .no-spinners {
            -moz-appearance: textfield;
          }
        `}</style>
        
        <input
          ref={inputRef}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="no-spinners w-full bg-app-input border border-app-border text-slate-100 rounded-lg py-2.5 pl-3 pr-8 focus:outline-none focus:border-brand-yellow/50 focus:ring-1 focus:ring-brand-yellow/50 transition-all font-mono text-base placeholder-slate-700"
        />
        
        {/* Custom Spin Controls (Visible on Hover of group or Focus) */}
        <div className="absolute right-1 inset-y-1 flex flex-col justify-center gap-0.5 w-5 opacity-50 group-hover/input:opacity-100 transition-opacity">
           <button 
             type="button"
             onClick={() => updateValue(step)}
             className="flex-1 flex items-center justify-center bg-white/5 hover:bg-brand-yellow/20 rounded-sm text-slate-400 hover:text-brand-yellow transition-colors"
             tabIndex={-1}
           >
             <ChevronUp size={10} strokeWidth={3} />
           </button>
           <button 
             type="button"
             onClick={() => updateValue(-step)}
             className="flex-1 flex items-center justify-center bg-white/5 hover:bg-brand-yellow/20 rounded-sm text-slate-400 hover:text-brand-yellow transition-colors"
             tabIndex={-1}
           >
             <ChevronDown size={10} strokeWidth={3} />
           </button>
        </div>

        {/* Unit Label (if provided) - Pushed left by controls */}
        {unit && (
          <div className="absolute right-8 inset-y-0 flex items-center pointer-events-none">
             <span className="text-slate-500 text-xs font-bold">{unit}</span>
          </div>
        )}
      </div>
    </div>
  );
};