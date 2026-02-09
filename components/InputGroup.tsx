import React, { useRef, useEffect, useMemo } from 'react';
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
  isQuantity?: boolean; // 新增：标记是否为数量（克数）输入框
}

export const InputGroup: React.FC<InputGroupProps> = ({
  label,
  value,
  onChange,
  type = "number",
  placeholder,
  icon,
  step = 0.01,
  unit,
  isQuantity = false
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  
  // 检测是否为 iOS 设备
  const isIOS = useMemo(() => {
    return typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
  }, []);

  const updateValue = (delta: number) => {
    const currentVal = parseFloat(value.toString()) || 0;
    const nextVal = Math.round((currentVal + delta) * 100) / 100;
    const nextStr = Number.isInteger(nextVal) ? nextVal.toString() : nextVal.toFixed(2);
    onChange(nextStr);
  };

  // 生成 iOS 滚轮选项：当前值前后各 50 个步长
  const pickerOptions = useMemo(() => {
    if (!isIOS || !isQuantity) return [];
    const current = parseFloat(value.toString()) || 0;
    const options = [];
    // 生成从 (current - 50*step) 到 (current + 50*step) 的选项
    for (let i = -50; i <= 50; i++) {
      const val = Math.round((current + i * step) * 100) / 100;
      if (val >= 0) {
        options.push(val);
      }
    }
    // 确保当前值一定在列表中（去重并排序）
    if (!options.includes(current)) {
      options.push(current);
    }
    return Array.from(new Set(options)).sort((a, b) => a - b);
  }, [isIOS, isQuantity, value, step]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el || isIOS) return; // iOS 上停用滚轮缩放，改用原生滚轮

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const direction = e.deltaY > 0 ? -1 : 1;
      updateValue(direction * step);
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [value, step, onChange, isIOS]);

  return (
    <div className="flex flex-col space-y-1.5 w-full group/input relative">
      <label className="text-[10px] text-app-subtext font-medium ml-1 truncate">{label}</label>
      <div className="relative flex items-center">
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
          readOnly={isIOS && isQuantity} // iOS 数量输入框设为只读，通过 select 触发
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="no-spinners w-full bg-app-input border border-app-border text-app-text rounded-lg py-2.5 pl-3 pr-10 focus:outline-none focus:border-brand-yellow/50 focus:ring-1 focus:ring-brand-yellow/50 transition-all font-mono text-base placeholder-app-subtext/50"
        />

        {/* iOS 滚轮触发器：一个完全透明但覆盖在输入框上的 select */}
        {isIOS && isQuantity && (
          <select
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            value={parseFloat(value.toString()) || 0}
            onChange={(e) => onChange(e.target.value)}
          >
            {pickerOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt} {unit || ''}
              </option>
            ))}
          </select>
        )}
        
        <div className="absolute right-0.5 inset-y-1 flex items-stretch py-0.5 z-20 pointer-events-none group-hover/input:pointer-events-auto">
           <div className="w-[1px] bg-app-border h-full mx-1 opacity-50"></div>
           <div className="flex flex-col justify-center gap-0.5 w-6 opacity-60 group-hover/input:opacity-100 transition-opacity">
              <button 
                type="button"
                onClick={() => updateValue(step)}
                className="flex-1 flex items-center justify-center hover:bg-brand-yellow/20 rounded-sm text-app-subtext hover:text-brand-yellow transition-colors"
                tabIndex={-1}
              >
                <ChevronUp size={12} strokeWidth={3} />
              </button>
              <button 
                type="button"
                onClick={() => updateValue(-step)}
                className="flex-1 flex items-center justify-center hover:bg-brand-yellow/20 rounded-sm text-app-subtext hover:text-brand-yellow transition-colors"
                tabIndex={-1}
              >
                <ChevronDown size={12} strokeWidth={3} />
              </button>
           </div>
        </div>

        {unit && (
          <div className="absolute right-10 inset-y-0 flex items-center pointer-events-none">
             <span className="text-app-subtext text-xs font-bold">{unit}</span>
          </div>
        )}
      </div>
    </div>
  );
};