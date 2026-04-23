import { type ButtonHTMLAttributes, forwardRef } from 'react';

type ButtonVariant = 'default' | 'ghost' | 'outline';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  default: 'bg-blue-500 hover:bg-blue-400 text-white border-transparent',
  ghost: 'bg-transparent hover:bg-neutral-800 text-neutral-300 border-transparent',
  outline: 'bg-transparent hover:bg-neutral-800 text-neutral-200 border-neutral-700',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'default', className = '', ...rest }, ref) => (
    <button
      ref={ref}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 ${VARIANT_CLASS[variant]} ${className}`}
      {...rest}
    />
  ),
);
Button.displayName = 'Button';
