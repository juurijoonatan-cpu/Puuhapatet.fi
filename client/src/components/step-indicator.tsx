import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Step {
  id: number;
  title: string;
}

interface StepIndicatorProps {
  steps: Step[];
  currentStep: number;
  className?: string;
}

export function StepIndicator({ steps, currentStep, className }: StepIndicatorProps) {
  return (
    <div className={cn("flex items-center justify-center gap-2", className)}>
      {steps.map((step, index) => {
        const isCompleted = step.id < currentStep;
        const isActive = step.id === currentStep;
        const isLast = index === steps.length - 1;

        return (
          <div key={step.id} className="flex items-center">
            <div
              className={cn(
                "flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium transition-all duration-300",
                isCompleted && "bg-primary text-primary-foreground",
                isActive && "bg-primary text-primary-foreground ring-4 ring-primary/20",
                !isCompleted && !isActive && "bg-muted text-muted-foreground"
              )}
              aria-current={isActive ? "step" : undefined}
            >
              {isCompleted ? (
                <Check className="w-4 h-4" />
              ) : (
                step.id
              )}
            </div>
            
            {!isLast && (
              <div
                className={cn(
                  "w-8 md:w-12 h-0.5 mx-1 transition-all duration-300",
                  isCompleted ? "bg-primary" : "bg-muted"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
