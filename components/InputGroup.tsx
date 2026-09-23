import React, { useRef, useEffect, useMemo } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { useStepWheel } from '../hooks/useStepWheel';

interface InputGroupProps {
  label?: React.ReactNode;
  value: number | string;
  onChange: (val: string) => void;
  type?: string;
  placeholder?: string;
  icon?: React.ReactNode;
  step?: number;
  unit?: string;
  isQuantity?: boolean; // 标记是否为数量（克数）输入框
  touchMode?: boolean; // 新增：是否启用触屏拖拽调节模式
  hideControls?: boolean; // 新增：是否隐藏增减按钮
  className?: string; // 新增：自定义样式
  min?: number;
  max?: number;
  onEnter?: () => void; // 新增：回车键回调
  inputRef?: React.RefObject<HTMLInputElement>; // 新增：父组件传入的 ref 用于聚焦
  onTypeSwitch?: (key: string) => boolean; // 新增：处理特殊按键（如[、]），返回 true 表示已处理，阻止默认输入
  onTab?: () => boolean; // 新增：处理 Tab 键（用于在两个输入框间循环切换），返回 true 表示已处理
  precision?: number; // 新增：数值保留小数位数（默认 2，ETF 价格传 3）
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
  isQuantity = false,
  touchMode = false,
  hideControls = false,
  className = "",
  min,
  max,
  onEnter,
  inputRef: externalInputRef,
  onTypeSwitch,
  onTab,
  precision = 2,
}) => {
  const internalInputRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef || internalInputRef;
  // 用 ref 存储最新的 value，供事件监听器使用，避免 stale closure
  const valueRef = useRef<number>(parseFloat(value.toString()) || 0);
  useEffect(() => {
    valueRef.current = parseFloat(value.toString()) || 0;
  }, [value]);

  // 检测是否为 iOS 设备
  const isIOS = useMemo(() => {
    return typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
  }, []);

  // 统一滚轮/触控板/触屏拖拽调节机制（与图表等其它控件完全共用同一套实现）
  const apply = useStepWheel({
    ref: inputRef,
    valueRef,
    step,
    min,
    max,
    precision,
    touch: touchMode,
    disabled: () => isIOS && !touchMode,
    onChange: (nextNum) => {
      onChange(Number.isInteger(nextNum) ? nextNum.toString() : nextNum.toFixed(precision));
    },
  });

  // iOS 滚轮选项：当前值前后各 50 个步长
  const pickerOptions = useMemo(() => {
    if (!isIOS || !isQuantity) return [];
    const current = parseFloat(value.toString()) || 0;
    const options = [];
    const mult = Math.pow(10, precision);
    // 生成从 (current - 50*step) 到 (current + 50*step) 的选项
    for (let i = -50; i <= 50; i++) {
      const val = Math.round((current + i * step) * mult) / mult;
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

  return (
    <div className="flex flex-col space-y-1.5 w-full group/input relative">
      {label && <label className="text-[10px] text-app-subtext font-medium ml-1 truncate">{label}</label>}

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
          // iOS: 只有在 quantity 模式且未开启 touchMode 时才设为只读以触发 picker
          // 如果开启 touchMode，允许用户交互（实际上会被 touchmove 拦截滚动）
          readOnly={isIOS && isQuantity && !touchMode} 
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onEnter) {
              e.preventDefault();
              onEnter();
              return;
            }
            // 处理 Tab 键（用于在两个输入框间循环切换）
            if (e.key === 'Tab' && onTab) {
              const handled = onTab();
              if (handled) {
                e.preventDefault();
                return;
              }
            }
            // 处理特殊按键（如 [ 和 ] 用于切换买入/卖出，' 用于来回切换）
            if (onTypeSwitch && (e.key === '[' || e.key === ']' || e.key === "'")) {
              const handled = onTypeSwitch(e.key);
              if (handled) {
                e.preventDefault();
              }
            }
          }}
          placeholder={placeholder}
          className={`no-spinners w-full bg-app-input border border-app-border text-app-text rounded-lg py-2.5 pl-3 ${hideControls ? 'pr-3' : 'pr-10'} focus:outline-none focus:border-brand-yellow/50 focus:ring-1 focus:ring-brand-yellow/50 transition-all font-mono text-base placeholder-app-subtext/50 ${touchMode ? 'cursor-ns-resize' : ''} ${className}`}
        />

        {/* iOS 滚轮触发器：仅在未开启 TouchMode 时显示 */}
        {isIOS && isQuantity && !touchMode && (
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
        
        {!hideControls && (
          <div className="absolute right-0.5 inset-y-1 flex items-stretch py-0.5 z-20 pointer-events-none group-hover/input:pointer-events-auto">
             <div className="w-[1px] bg-app-border h-full mx-1 opacity-50"></div>
             <div className="flex flex-col justify-center gap-0.5 w-6 opacity-60 group-hover/input:opacity-100 transition-opacity">
                <button 
                  type="button"
                  onClick={() => apply(step)}
                  className="flex-1 flex items-center justify-center hover:bg-brand-yellow/20 rounded-sm text-app-subtext hover:text-brand-yellow transition-colors"
                  tabIndex={-1}
                >
                  <ChevronUp size={12} strokeWidth={3} />
                </button>
                <button 
                  type="button"
                  onClick={() => apply(-step)}
                  className="flex-1 flex items-center justify-center hover:bg-brand-yellow/20 rounded-sm text-app-subtext hover:text-brand-yellow transition-colors"
                  tabIndex={-1}
                >
                  <ChevronDown size={12} strokeWidth={3} />
                </button>
             </div>
          </div>
        )}

        {unit && (
          <div className="absolute right-10 inset-y-0 flex items-center pointer-events-none">
             <span className="text-app-subtext text-xs font-bold">{unit}</span>
          </div>
        )}
      </div>
    </div>
  );
};