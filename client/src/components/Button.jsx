const VARIANT_CLASSES = {
  primary:
    'bg-gradient-to-b from-gold-400 to-gold-600 text-felt-950 border border-gold-300/60 shadow-md hover:brightness-110 active:scale-95 disabled:from-white/10 disabled:to-white/10 disabled:text-white/30 disabled:border-white/10 disabled:shadow-none disabled:active:scale-100',
  ghost:
    'bg-white/5 text-cream-50 border border-white/15 hover:bg-white/10 active:scale-95 disabled:opacity-30 disabled:active:scale-100',
};

function Button({ variant = 'primary', className = '', children, ...props }) {
  return (
    <button
      className={`rounded-full px-5 py-2 font-display font-bold text-base tracking-wide transition-all duration-150 disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export default Button;
