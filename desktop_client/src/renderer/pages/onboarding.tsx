import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function Onboarding() {
  const navigate = useNavigate();
  const [isCompleting, setIsCompleting] = useState(false);

  async function completeOnboarding() {
    setIsCompleting(true);
    try {
      await window.desktopClient.completeOnboarding();
      navigate('/home', { replace: true });
    } catch {
      toast.error('Setup could not be saved. Please try again.');
    } finally {
      setIsCompleting(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center p-6">
      <Card className="w-full max-w-xl border-white/10 bg-card/95 shadow-2xl shadow-black/30">
        <CardHeader className="space-y-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            <span className="size-2 rounded-full bg-primary shadow-[0_0_12px_var(--primary)]" /> Quantum Ledger
          </div>
          <CardTitle className="text-3xl tracking-tight">Welcome. Let’s get you set up.</CardTitle>
          <CardDescription>
            Your workspace is ready to begin. You can change your preferences and add details any time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" disabled={isCompleting} onClick={completeOnboarding}>
            {isCompleting ? 'Finishing setup…' : 'Finish setup'}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
