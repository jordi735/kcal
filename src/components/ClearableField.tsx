import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { XMarkIcon } from './Icon';
import styles from './ClearableField.module.css';

type ClearableFieldProps = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string | undefined;
  type?: string | undefined;
  inputMode?: JSX.HTMLAttributes<HTMLInputElement>['inputMode'];
  autoComplete?: string | undefined;
  maxLength?: number | undefined;
  className?: string | undefined;
  wrapClassName?: string | undefined;
  onKeyDown?: JSX.KeyboardEventHandler<HTMLInputElement> | undefined;
};

export function ClearableField({
  value,
  onChange,
  className,
  wrapClassName,
  ...rest
}: ClearableFieldProps) {
  const ref = useRef<HTMLInputElement>(null);
  const wrapClass = `${styles.wrap}${wrapClassName ? ` ${wrapClassName}` : ''}`;
  const inputClass = `field-input ${styles.input}${className ? ` ${className}` : ''}`;
  return (
    <div className={wrapClass}>
      <input
        {...rest}
        ref={ref}
        value={value}
        onInput={(e) => onChange(e.currentTarget.value)}
        className={inputClass}
      />
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => {
            onChange('');
            ref.current?.focus();
          }}
          className={styles.clear}
          aria-label="Clear"
        >
          <XMarkIcon size={14} />
        </button>
      )}
    </div>
  );
}
