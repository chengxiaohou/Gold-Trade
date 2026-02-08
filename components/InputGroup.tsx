
import React, { useRef, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronUp, ChevronDown, X, GripHorizontal, RotateCcw } from 'lucide-react';

interface InputGroupProps {
  label?: string;
  value: number | string;
  onChange: (val: string) => void;
  type?: string;
  placeholder?: string;
  icon?: React.ReactNode;
  step?: number;
  unit?: string;
  isQuantity?: boolean;
  inputClassName?: string;
  containerClassName?: string;
  hideLabel?: boolean;
}

// --- 可拖拽的 3D 滚轮气泡 ---
const DraggableWheelBubble: React.FC<{
  initialPosition: { top: number, left: number };
  currentValue: number;
  step: number;
  unit: string;
  label: string;
  onChange: (val: string) => void;
  onClose: () => void;
}> = ({ initialPosition, currentValue, step, unit, label, onChange, onClose }) => {
  const [position, setPosition] = useState(initialPosition);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const isDragging = useRef(false);
  
  const itemHeight = 32; 
  const containerHeight = 160;
  const initialValSnapshot = useRef(currentValue);

  const options = useMemo(() => {
    const list = [];
    const base = Math.round(currentValue / step) * step;
    for (let i = -100; i <= 100; i++) {
      const v = Math.max(0, Math.round((base + i * step) * 100) / 100);
      list.push(v);
    }
    return Array.from(new Set(list)).sort((a, b) => a - b);
  }, [step, currentValue]);

  const [activeIndex, setActiveIndex] = useState(() => {
    const idx = options.indexOf(Math.round(currentValue * 100) / 100);
    return idx === -1 ? 0 : idx;
  });

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const scrollTop = scrollRef.current.scrollTop;
    const index = Math.round(scrollTop / itemHeight);
    
    if (options[index] !== undefined && index !== activeIndex) {
      setActiveIndex(index);
      const val = options[index];
      const valStr = Number.isInteger(val) ? val.toString() : val.toFixed(2);
      onChange(valStr);
      if (window.navigator.vibrate) window.navigator.vibrate(5);
    }
  };

  useEffect(() => {
    if (scrollRef.current) {
      const idx = options.indexOf(Math.round(currentValue * 100) / 100);
      scrollRef.current.scrollTop = (idx === -1 ? 0 : idx) * itemHeight;
    }
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!bubbleRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = bubbleRef.current.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    isDragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    bubbleRef.current.style.transition = 'none';
    document.body.style.cursor = 'grabbing';
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current || !bubbleRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const newLeft = e.clientX - dragOffset.current.x;
    const newTop = e.clientY - dragOffset.current.y;
    bubbleRef.current.style.left = `${newLeft}px`;
    bubbleRef.current.style.top = `${newTop}px`;
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging.current || !bubbleRef.current) return;
    isDragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.style.cursor = '';
    const rect = bubbleRef.current.getBoundingClientRect();
    setPosition({ left: rect.left, top: rect.top });
    bubbleRef.current.style.transition = '';
  };

  const handleReset = () => {
    const val = initialValSnapshot.current;
    const valStr = Number.isInteger(val) ? val.toString() : val.toFixed(2);
    onChange(valStr);
    if (scrollRef.current) {
      const idx = options.indexOf(Math.round(val * 100) / 100);
      scrollRef.current.scrollTo({ top: (idx === -1 ? 0 : idx) * itemHeight, behavior: 'smooth' });
    }
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" onClick={onClose} />
      <div 
        ref={bubbleRef}
        style={{ top: position.top, left: position.left, width: '200px' }}
        className="fixed z-[9999] bg-app-card border border-app-border shadow-[0_10px_40px_-10px_rgba(0,0,0,0.7)] rounded-xl flex flex-col overflow-hidden animate-in zoom-in-95 fade-in duration-200"
      >
        <div 
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="bg-app-bg/80 backdrop-blur-md p-2 flex justify-between items-center border-b border-white/5 cursor-grab active:cursor-grabbing touch-none select-none"
        >
          <div className="flex items-center gap-1.5 text-app-subtext pointer-events-none">
            <GripHorizontal size={12} className="opacity-80"/>
            <h4 className="text-[10px] font-bold tracking-widest uppercase truncate max-w-[90px]">{label}</h4>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={handleReset} onPointerDown={(e) => e.stopPropagation()} className="text-app-subtext hover:text-brand-yellow transition-colors bg-app-text/5 hover:bg-app-text/10 rounded p-1" title="重置数值"><RotateCcw size={11} /></button>
            <button onClick={onClose} onPointerDown={(e) => e.stopPropagation()} className="text-app-subtext hover:text-app-text transition-colors bg-app-text/5 hover:bg-app-text/10 rounded p-1"><X size={12} /></button>
          </div>
        </div>
        <div className="relative bg-app-bg/50 flex items-center justify-center overflow-hidden" style={{ height: `${containerHeight}px` }}>
          <div className="absolute top-1/2 -translate-y-1/2 w-full pointer-events-none" style={{ height: `${itemHeight}px` }}>
            <div className="absolute top-0 inset-x-0 h-[1px] bg-app-border" />
            <div className="absolute bottom-0 inset-x-0 h-[1px] bg-app-border" />
            <div className="absolute inset-0 bg-brand-yellow/[0.04]" />
          </div>
          <div ref={scrollRef} onScroll={handleScroll} className="w-full h-full overflow-y-scroll no-scrollbar snap-y snap-mandatory">
            <div style={{ height: (containerHeight - itemHeight) / 2 }} />
            <div className="flex flex-col items-center">
              {options.map((opt, i) => {
                const distance = Math.abs(i - activeIndex);
                const opacity = Math.max(0.1, 1 - distance * 0.35);
                const rotateX = (i - activeIndex) * 28;
                const scale = Math.max(0.8, 1 - distance * 0.08);
                return (
                  <div key={i} className="flex items-center justify-center snap-center w-full transition-all duration-75" style={{ height: `${itemHeight}px`, opacity, transform: `rotateX(${rotateX}deg) scale(${scale})`, perspective: '500px' }}>
                    <span className={`font-mono text-sm ${distance === 0 ? 'text-brand-yellow font-bold' : 'text-app-subtext'}`}>{opt.toFixed(2)}</span>
                  </div>
                );
              })}
            </div>
            <div style={{ height: (containerHeight - itemHeight) / 2 }} />
          </div>
          <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-app-bg/90 via-transparent to-app-bg/90" />
        </div>
        <div className="bg-app-card py-1 border-t border-white/5 text-center">
           <span className="text-[8px] text-app-subtext font-bold uppercase tracking-[0.2em]">{unit || '调节器'}</span>
        </div>
      </div>
    </>,
    document.body
  );
};

export const InputGroup: React.FC<InputGroupProps> = ({
  label = "",
  value,
  onChange,
  type = "number",
  placeholder,
  step = 0.01,
  unit = "",
  inputClassName = "",
  containerClassName = "",
  hideLabel = false
}) => {
  const inputRef = useRef<HTMLDivElement>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  
  const updateValue = (delta: number) => {
    const currentVal = parseFloat(value.toString()) || 0;
    const nextVal = Math.round((currentVal + delta) * 100) / 100;
    const finalVal = Math.max(0, nextVal);
    const nextStr = Number.isInteger(finalVal) ? finalVal.toString() : finalVal.toFixed(2);
    onChange(nextStr);
  };

  const handleTriggerPicker = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (inputRef.current) {
      setAnchorRect(inputRef.current.getBoundingClientRect());
      setShowPicker(true);
    }
  };

  return (
    <div className={`flex flex-col space-y-1.5 w-full group/input relative ${containerClassName}`} ref={inputRef}>
      {!hideLabel && label && <label className="text-[10px] text-app-subtext font-medium ml-1 truncate">{label}</label>}
      <div className="relative flex items-center h-full min-h-[40px]">
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`no-spinners w-full h-full bg-app-input border border-app-border text-app-text rounded-lg pl-3 pr-10 focus:outline-none focus:border-brand-yellow/50 focus:ring-1 focus:ring-brand-yellow/50 transition-all font-mono text-base placeholder-app-subtext/50 ${inputClassName}`}
        />

        <div className="absolute right-0.5 inset-y-1 flex items-stretch py-0.5 z-20">
           <div className="w-[1px] bg-app-border h-full mx-1 opacity-50"></div>
           {/* 修改点：将触发器绑定到整个按钮区域，并允许冒泡或直接调用 */}
           <div className="flex flex-col justify-center gap-0.5 w-6 opacity-60 group-hover/input:opacity-100 transition-opacity cursor-pointer" onClick={handleTriggerPicker}>
              <button 
                type="button" 
                onClick={(e) => { 
                  // 如果按下的是鼠标左键且没有长按，依然可以执行步进
                  // 但为了保证选择器优先，我们可以直接触发选择器
                  updateValue(step); 
                }} 
                className="flex-1 flex items-center justify-center rounded-sm text-app-subtext hover:bg-brand-yellow/20 hover:text-brand-yellow transition-colors" 
                tabIndex={-1}
              >
                <ChevronUp size={12} strokeWidth={3} />
              </button>
              <button 
                type="button" 
                onClick={(e) => { 
                  updateValue(-step); 
                }} 
                className="flex-1 flex items-center justify-center rounded-sm text-app-subtext hover:bg-brand-yellow/20 hover:text-brand-yellow transition-colors" 
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

        {showPicker && anchorRect && (
          <DraggableWheelBubble 
            initialPosition={{
              top: anchorRect.bottom + 8 + (anchorRect.bottom + 210 > window.innerHeight ? -anchorRect.height - 218 : 0),
              left: Math.max(10, Math.min(window.innerWidth - 210, anchorRect.right - 200))
            }}
            label={label}
            currentValue={parseFloat(value.toString()) || 0}
            step={step}
            unit={unit}
            onClose={() => setShowPicker(false)}
            onChange={onChange}
          />
        )}
      </div>
    </div>
  );
};
