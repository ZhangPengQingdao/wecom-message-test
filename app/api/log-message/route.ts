import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: Request) {
    try {
    const body = await request.json();
    const { content, sender } = body;

    // API Key Validation
    const apiKey = request.headers.get('authorization')?.replace('Bearer ', '') || 
                   new URL(request.url).searchParams.get('api_key');
    
    const validApiKey = process.env.API_SECRET_KEY;

    if (!validApiKey) {
        console.warn('API_SECRET_KEY is not set in environment variables. Skipping auth.');
    } else if (apiKey !== validApiKey) {
        return NextResponse.json(
            { error: 'Unauthorized: Invalid API Key' },
            { status: 401 }
        );
    }

        if (!content) {
            return NextResponse.json(
                { error: 'Missing content field' },
                { status: 400 }
            );
        }

        // Insert into Supabase
        const { data, error } = await supabase
            .from('messages')
            .insert([
                {
                    content,
                    sender: sender || 'unknown',
                    raw_data: body,
                },
            ])
            .select();

        if (error) {
            console.error('Supabase error:', error);
            return NextResponse.json(
                { error: 'Failed to log message' },
                { status: 500 }
            );
        }

        return NextResponse.json({ success: true, data });
    } catch (error) {
        console.error('Error processing request:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
