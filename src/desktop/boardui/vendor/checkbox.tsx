"use client";

import type { ReactNode, Ref } from "react";
import { Checkbox as AriaCheckbox } from "react-aria-components";
import type { CheckboxProps as AriaCheckboxProps } from "react-aria-components";
// BoardUI MIT source; selected fill adapted to the user's no-gradient requirement.
import { cx } from "../cx";
import { CheckboxGlyph, checkboxSizes } from "./checkbox-glyph";
import type { CheckboxSize } from "./checkbox-glyph";

/**
 * Figma source: Board UI → Checkbox (node 3699:2557 family; used in
 * dashboard 1 table, nodes 3731:3258 etc.).
 *
 * radius/sm (4px). Two sizes:
 *   md  16×16, label Body 1/Medium (14)
 *   sm  14×14, label Body 2/Medium (13)
 *
 * States (per Figma):
 *   default        bg background/primary/default, 1px border/checkbox/default,
 *                  shadow/xs
 *   hover          border darkens to neutral/400
 * SyncFu adaptation: checked/mixed use a solid brand fill and Morphicons,
 * never the upstream selected-fill effect. Focus and label semantics remain.
 *
 * Built on react-aria Checkbox: keyboard toggling, aria-checked="mixed" for
 * indeterminate, label association when `children` is passed.
 */

export interface CheckboxProps extends Omit<AriaCheckboxProps, "children"> {
  children?: ReactNode;
  size?: CheckboxSize;
  ref?: Ref<HTMLLabelElement>;
}

export function Checkbox({ className, children, size = "md", ref, ...props }: CheckboxProps) {
  const s = checkboxSizes[size];

  return (
    <AriaCheckbox
      ref={ref}
      {...props}
      className={(state) =>
        cx(
          "bui-checkbox relative group inline-flex items-center select-none",
          s.gap,
          state.isDisabled ? "cursor-not-allowed" : "cursor-pointer",
          typeof className === "function" ? className(state) : className,
        )
      }
    >
      {(state) => (
        <>
          <CheckboxGlyph state={state} size={size} />
          {children !== undefined && children !== null && (
            <span className={cx(s.label, "text-text-primary")}>{children}</span>
          )}
        </>
      )}
    </AriaCheckbox>
  );
}
