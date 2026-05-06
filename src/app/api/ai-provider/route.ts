import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId');
    
    console.log('[API] Fetching AI provider for userId:', userId);
    
    if (!userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 });
    }

    // Use service role key on server side
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );

    console.log('[API] Querying ai_settings table...');

    // First try to get active provider
    let { data: aiProvider, error } = await supabase
      .from('ai_settings')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();

    // If no active provider, try to get any provider for this user
    if (!aiProvider) {
      console.log('[API] No active provider, checking for any provider...');
      const { data: anyProvider } = await supabase
        .from('ai_settings')
        .select('*')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();
      
      if (anyProvider) {
        console.log('[API] Found inactive provider, activating it...');
        // Activate it automatically
        const { data: updated } = await supabase
          .from('ai_settings')
          .update({ is_active: true })
          .eq('id', anyProvider.id)
          .select()
          .single();
        
        aiProvider = updated;
      }
    }

    console.log('[API] Query result:', { aiProvider, error });

    if (error || !aiProvider) {
      console.error('[API] Error or no provider:', error);
      return NextResponse.json(
        { 
          error: 'No AI provider configured. Please set up your AI provider in Settings first.', 
          details: error?.message || 'No data',
          userId,
        },
        { status: 404 }
      );
    }

    console.log('[API] Success! Returning provider:', aiProvider.provider);
    return NextResponse.json(aiProvider);
  } catch (err: any) {
    console.error('[API] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: err.message },
      { status: 500 }
    );
  }
}
