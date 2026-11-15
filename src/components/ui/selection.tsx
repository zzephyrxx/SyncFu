import {useId,type ComponentProps,type ReactNode} from 'react';
import {Checkbox as ShadcnCheckbox} from './checkbox';
import {cn} from './utils';

export interface SelectionProps extends Omit<ComponentProps<typeof ShadcnCheckbox>,'checked'|'defaultChecked'|'onCheckedChange'|'onChange'|'children'|'slot'> {
  isSelected?:boolean;
  isIndeterminate?:boolean;
  isDisabled?:boolean;
  onChange?:(value:boolean)=>void;
  children?:ReactNode;
  slot?:string|null;
}

/** Compatibility for the existing selection contract, backed by shadcn/Radix. */
export function Checkbox({isSelected=false,isIndeterminate=false,isDisabled=false,onChange,children,className,id,slot:_slot,...props}:SelectionProps){
  const generated=useId();const inputId=id??generated;
  const control=<ShadcnCheckbox {...props} id={inputId} className={cn('sfu-checkbox',!children&&className)} checked={isIndeterminate?'indeterminate':isSelected} disabled={isDisabled||props.disabled} onCheckedChange={value=>onChange?.(value===true)}/>;
  return children?<label className={cn('sfu-selection-label',className)} htmlFor={inputId}>{control}<span>{children}</span></label>:control;
}

export interface CheckboxCardProps extends Omit<SelectionProps,'children'|'title'> {title:ReactNode;description?:ReactNode}
export function CheckboxCard({title,description,className,isSelected=false,isIndeterminate=false,isDisabled=false,id,...props}:CheckboxCardProps){
  const generated=useId();const inputId=id??generated;
  return <label htmlFor={inputId} className={cn('sfu-selection-card',className)} data-state={isIndeterminate?'indeterminate':isSelected?'checked':'unchecked'} data-disabled={isDisabled||undefined}>
    <span className="sfu-selection-card-text"><span>{title}</span>{description&&<span className="sfu-selection-card-description">{description}</span>}</span>
    <span><Checkbox {...props} id={inputId} isSelected={isSelected} isIndeterminate={isIndeterminate} isDisabled={isDisabled}/></span>
  </label>;
}
