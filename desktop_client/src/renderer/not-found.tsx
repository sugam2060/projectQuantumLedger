import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Page not found</CardTitle>
          <CardDescription>The page you requested does not exist.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to="/">Return to home</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
