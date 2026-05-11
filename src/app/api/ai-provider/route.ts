import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId');
    
    console.log('[AI-Provider API] ========== START ==========');
    console.log('[AI-Provider API] Fetching AI provider for userId:', userId);
    
    if (!userId) {
      console.log('[AI-Provider API] ERROR: No userId provided');
      return NextResponse.json({ error: 'userId required' }, { status: 400 });
    }

    // Use service role key on server side to bypass RLS
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    
    console.log('[AI-Provider API] Supabase URL:', supabaseUrl ? 'Set ✓' : 'MISSING ✗');
    console.log('[AI-Provider API] Service Key:', supabaseKey ? `Set ✓ (${supabaseKey.substring(0, 20)}...)` : 'MISSING ✗');
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('[AI-Provider API] ERROR: Missing Supabase credentials');
      return NextResponse.json(
        { error: 'Server configuration error', details: 'Missing Supabase credentials' },
        { status: 500 }
      );
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    console.log('[AI-Provider API] Querying ai_settings table for user:', userId);

    // First try to get active provider
    const { data: aiProvider, error, count } = await supabase
      .from('ai_settings')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();

    console.log('[AI-Provider API] Active provider query result:', { 
      found: !!aiProvider, 
      error: error?.message,
      errorCode: error?.code,
      provider: aiProvider?.provider,
      totalCount: count
    });

    // If no active provider, try to get any provider for this user
    if (!aiProvider && !error) {
      console.log('[AI-Provider API] No active provider, checking for ANY provider...');
      const { data: anyProvider, error: anyError } = await supabase
        .from('ai_settings')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      
      console.log('[AI-Provider API] Any provider query result:', { 
        found: !!anyProvider, 
        error: anyError?.message,
        provider: anyProvider?.provider 
      });
      
      if (anyProvider) {
        console.log('[AI-Provider API] Found inactive provider, activating it...');
        const { data: updated, error: updateError } = await supabase
          .from('ai_settings')
          .update({ is_active: true })
          .eq('id', anyProvider.id)
          .select()
          .single();
        
        console.log('[AI-Provider API] Update result:', { 
          success: !!updated, 
          error: updateError?.message 
        });
        
        if (updated) {
          console.log('[AI-Provider API] SUCCESS! Returning activated provider:', updated.provider);
          console.log('[AI-Provider API] ========== END ==========');
          return NextResponse.json(updated);
        }
      }
    }

    if (error) {
      console.error('[AI-Provider API] Database error:', error);
      return NextResponse.json(
        { 
          error: 'Database error', 
          details: error.message,
          code: error.code,
          hint: error.hint,
          userId
        },
        { status: 500 }
      );
    }

    if (!aiProvider) {
      console.error('[AI-Provider API] No provider found for user');
      return NextResponse.json(
        { 
          error: 'No AI provider configured', 
          details: 'No records found in ai_settings table for this user',
          userId,
          hint: 'Go to http://localhost:3000/debug-ai-setup to add a provider'
        },
        { status: 404 }
      );
    }

    console.log('[AI-Provider API] SUCCESS! Returning provider:', aiProvider.provider);
    console.log('[AI-Provider API] ========== END ==========');
    return NextResponse.json(aiProvider);
    
  } catch (err: any) {
    console.error('[AI-Provider API] UNEXPECTED ERROR:', err);
    console.error('[AI-Provider API] Error stack:', err.stack);
    return NextResponse.json(
      { error: 'Internal server error', details: err.message, stack: err.stack },
      { status: 500 }
    );
  }
}
