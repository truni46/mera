import { useState } from 'react';
import { FaBriefcase, FaPalette } from 'react-icons/fa';

type Mode = 'work' | 'creative';

const MODES: { id: Mode; label: string; icon: JSX.Element }[] = [
    { id: 'work', label: 'Work', icon: <FaBriefcase /> },
    { id: 'creative', label: 'Creative', icon: <FaPalette /> },
];

function NotchModeToggle() {
    const [mode, setMode] = useState<Mode>('work');

    return (
        <div className="absolute top-px left-1/2 -translate-x-1/2 flex items-start">
            <div className="bg-white p-3">
                <div className="flex items-center gap-1 bg-app-bg rounded-full p-1">
                    {MODES.map((m) => (
                        <button
                            key={m.id}
                            onClick={() => setMode(m.id)}
                            className={`flex items-center gap-0.5 px-3 py-1 rounded-full text-xs font-medium transition-all duration-200 ${
                                mode === m.id
                                    ? 'bg-white text-gray-900 shadow-sm'
                                    : 'text-gray-400 hover:text-gray-600'
                            }`}
                        >
                            <span className="text-xs">{m.icon}</span>
                            {m.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

export default function NotchBar() {
    return (
        <div className="relative flex-shrink-0">
            <NotchModeToggle />
        </div>
    );
}
