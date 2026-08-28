/**
 * Install Skill Button.
 *
 * Downloads a zip containing SKILL.md + install.sh that the user
 * can unzip and run to install the skill into their AI agent.
 */

import { useState, useCallback } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { Button } from '@wordpress/components';
import { download } from '@wordpress/icons';
import { Stack, Text } from '@wordpress/ui';
import JSZip from 'jszip';

import './InstallSkillButton.css';

const SKILL_NAMES = {
	agent: 'create-vip-workflow-agent',
	tool: 'create-vip-workflow-tool',
	'notification-channel': 'create-vip-workflow-notification-channel',
};

const SKILL_LABELS = {
	agent: 'Research Agent',
	tool: 'Editorial Tool',
	'notification-channel': 'Notification Channel',
};

function buildInstallScript( skillName ) {
	return `#!/bin/bash
#
# Install VIP Workflow skill: ${ skillName }
#

SKILL_DIR="$( cd "$( dirname "$0" )" && pwd )"
SKILL_NAME="${ skillName }"

echo ""
echo "VIP Workflow Skill Installer"
echo "============================"
echo ""
echo "Select your AI agent:"
echo "  1) Claude Code (default)"
echo "  2) Cursor"
echo ""
read -r -p "Choice [1]: " choice

case "\${choice}" in
    2)
        TARGET_BASE="\$HOME/.cursor/skills"
        AGENT_NAME="Cursor"
        ;;
    *)
        TARGET_BASE="\$HOME/.claude/skills"
        AGENT_NAME="Claude Code"
        ;;
esac

TARGET_DIR="\${TARGET_BASE}/\${SKILL_NAME}"

mkdir -p "\${TARGET_DIR}"
cp "\${SKILL_DIR}/SKILL.md" "\${TARGET_DIR}/SKILL.md"

echo ""
echo "Installed to \${TARGET_DIR}/SKILL.md (\${AGENT_NAME})"
echo ""

read -r -p "Delete this installer folder? [Y/n]: " cleanup
case "\${cleanup}" in
    [nN]*)
        echo "Keeping \${SKILL_DIR}"
        ;;
    *)
        rm -rf "\${SKILL_DIR}"
        echo "Cleaned up."
        ;;
esac

echo "Done."
`;
}

export default function InstallSkillButton( { skillType } ) {
	const [ downloading, setDownloading ] = useState( false );

	const skillName = SKILL_NAMES[ skillType ] || skillType;
	const skillLabel = SKILL_LABELS[ skillType ] || skillType;
	const skillContent = window.vipWorkflowAdmin?.skills?.[ skillType ] || '';

	const handleDownload = useCallback( async () => {
		if ( ! skillContent || downloading ) {
			return;
		}

		setDownloading( true );

		try {
			const zip = new JSZip();
			const folder = zip.folder( skillName );
			folder.file( 'SKILL.md', skillContent );
			folder.file( 'install.sh', buildInstallScript( skillName ), {
				unixPermissions: '755',
			} );

			const blob = await zip.generateAsync( {
				type: 'blob',
				platform: 'UNIX',
			} );

			const url = URL.createObjectURL( blob );
			const link = document.createElement( 'a' );
			link.href = url;
			link.download = `${ skillName }.zip`;
			document.body.appendChild( link );
			link.click();
			document.body.removeChild( link );
			URL.revokeObjectURL( url );
		} finally {
			setDownloading( false );
		}
	}, [ skillContent, skillName, downloading ] );

	if ( ! skillContent ) {
		return null;
	}

	return (
		// wpds-allow R7 -- surface wrapper (background/padding/radius), not a layout row
		<div className="vip-workflow-install-skill">
			<Stack direction="column" gap="xs">
				<Button
					variant="secondary"
					icon={ download }
					onClick={ handleDownload }
					isBusy={ downloading }
					disabled={ downloading }
					className="vip-workflow-install-skill__btn"
				>
					{ sprintf(
						/* translators: %s: the skill's display name, e.g. "Create Agent". */
						__( 'Download %s skill', 'vip-workflow' ),
						skillLabel
					) }
				</Button>
				<Text variant="body-sm">
					{ __(
						'Unzip and run install.sh to add this skill to Claude Code or Cursor.',
						'vip-workflow'
					) }
				</Text>
			</Stack>
		</div>
	);
}
