import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://rjtrcxnjbdlytiagrkcy.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqdHJjeG5qYmRseXRpYWdya2N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1MzY4ODQsImV4cCI6MjA5MjExMjg4NH0.5lt7jktrSF1npjVCsOrkhil7f6dy2a2RUklYmSYgnCo'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
