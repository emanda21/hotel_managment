import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { message, menu } = await req.json()

    const menuContext = menu
      .map(
        (item: any) =>
          `${item.name} ($${(item.price / 100).toFixed(2)}) - ${item.description} [${item.category}]`
      )
      .join('\n')

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        system: `You are a friendly restaurant assistant. Here is the menu:\n${menuContext}\n\nAnswer guest questions about the food and drinks helpfully and concisely. Only discuss items on this menu. If asked about something not on the menu, politely say it's not available.`,
        messages: [{ role: 'user', content: message }],
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      console.error('Anthropic API error:', data)
      return NextResponse.json(
        { reply: 'Sorry, something went wrong on my end.' },
        { status: 500 }
      )
    }

    const reply = data.content?.[0]?.text || 'Sorry, I could not respond right now.'
    return NextResponse.json({ reply })
  } catch (err) {
    console.error(err)
    return NextResponse.json(
      { reply: 'Sorry, something went wrong.' },
      { status: 500 }
    )
  }
}