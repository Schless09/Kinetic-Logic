import { HomeAuthLinks } from "@/components/auth/HomeAuthLinks";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 font-sans">
      <main className="flex max-w-md flex-col items-center gap-8 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Kinetic Logic</h1>
        <p className="text-muted-foreground">
          Collect Vision-Language-Action (VLA) data for AI training: video + motion sensors in sync.
        </p>
        <HomeAuthLinks />
      </main>
    </div>
  );
}
