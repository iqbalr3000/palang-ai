import { cn } from "@/lib/utils";

// A plain <select> so filter forms work as GET forms without client JS.
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-9 cursor-pointer rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className,
      )}
      {...props}
    />
  );
}
