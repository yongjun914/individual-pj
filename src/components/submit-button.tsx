"use client";

import { useFormStatus } from "react-dom";

type Props = React.ComponentProps<"button"> & {
  pendingText?: string;
};

/** 폼 제출 중에는 비활성화되고 문구가 바뀌는 버튼 */
export function SubmitButton({ children, pendingText, className = "", ...props }: Props) {
  const { pending, data } = useFormStatus();
  // 한 폼에 버튼이 여러 개(name/value)면 실제로 누른 버튼에만 진행 문구를 보인다.
  const isThisButton =
    props.name === undefined || data?.get(props.name) === String(props.value);

  return (
    <button
      type="submit"
      {...props}
      disabled={pending || props.disabled}
      aria-disabled={pending || props.disabled}
      className={`inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl px-4 text-base font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {pending && pendingText && isThisButton ? pendingText : children}
    </button>
  );
}
