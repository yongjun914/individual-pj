export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">학생회 회계</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          결제하면 바로 영수증을 남기고, 감사 시즌에는 버튼 한 번으로 엑셀과
          증빙 PDF를 받으세요.
        </p>
      </div>
      <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
        초기 세팅 완료. 로그인과 학생회 생성 화면을 만들 차례입니다.
      </p>
    </main>
  );
}
