export default defineAppConfig({
  ui: {
    colors: {
      primary: 'blue',
      neutral: 'neutral'
    },
    button: {
      defaultVariants: { size: 'sm' }
    },
    input: {
      defaultVariants: { size: 'sm', variant: 'outline' }
    },
    select: {
      defaultVariants: { size: 'sm', variant: 'outline' }
    },
    textarea: {
      defaultVariants: { size: 'sm', variant: 'outline' }
    },
    table: {
      slots: {
        th: 'h-8 px-3 py-0 bg-muted/65 text-muted font-semibold',
        td: 'h-8 px-3 py-0 border-t border-muted text-default'
      }
    }
  }
})
