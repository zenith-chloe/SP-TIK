#!/bin/bash
# Setup script for 60-day data retention cleanup

set -e

echo "=========================================="
echo "MotoParts ERP: Setup 60-Day Retention Policy"
echo "=========================================="
echo

# Check prerequisites
if ! command -v supabase &> /dev/null; then
    echo "❌ supabase CLI not found. Install it first:"
    echo "   npm install -g supabase"
    exit 1
fi

if [ -z "$SUPABASE_ACCESS_TOKEN" ]; then
    echo "⚠️  SUPABASE_ACCESS_TOKEN not set"
    echo "   Get it from: https://supabase.com/dashboard/account/tokens"
    echo "   Then run: export SUPABASE_ACCESS_TOKEN=your-token"
    exit 1
fi

# Prompt for project reference
read -p "Enter Supabase PROJECT_REF (e.g., abcdefghijklmnop): " PROJECT_REF

if [ -z "$PROJECT_REF" ]; then
    echo "❌ PROJECT_REF is required"
    exit 1
fi

echo
echo "Deploying cleanup-old-orders function..."
echo

# Deploy the function
supabase functions deploy cleanup-old-orders --project-ref "$PROJECT_REF"

if [ $? -eq 0 ]; then
    echo
    echo "✅ Deployment successful!"
    echo
    echo "Next steps:"
    echo "1. Test the cleanup function (dry run):"
    echo "   curl -X POST https://${PROJECT_REF}.supabase.co/functions/v1/cleanup-old-orders \\"
    echo "     -H 'Authorization: Bearer YOUR_ANON_KEY' \\"
    echo "     -H 'Content-Type: application/json' \\"
    echo "     -d '{\"dryRun\": true, \"retentionDays\": 60}'"
    echo
    echo "2. Set up GitHub Actions for daily cleanup:"
    echo "   - Add workflow files from .github/workflows/cleanup-old-orders.yml"
    echo "   - Set GitHub secrets: SUPABASE_PROJECT_REF, SUPABASE_ANON_KEY, SUPABASE_ACCESS_TOKEN"
    echo "   - Or run manually: curl ... with dryRun=false"
    echo
    echo "3. Check deployment logs:"
    echo "   supabase functions show cleanup-old-orders --project-ref $PROJECT_REF"
    echo
    echo "📖 Full docs: https://github.com/zenith-chloe/SP-TIK/blob/main/RETENTION_POLICY.md"
else
    echo "❌ Deployment failed. Check your credentials and project reference."
    exit 1
fi
