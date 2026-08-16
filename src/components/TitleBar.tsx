interface TitleBarProps {
    title: string;
    isNew?: boolean;
}

export default function TitleBar({ title, isNew }: TitleBarProps) {
    return (
        <div className="flex-shrink-0 px-6 py-3 pt-10 pl-12 bg-white rounded-t-2xl border border-gray-200 border-b-0">
            {!isNew && (
                <h2 className="font-semibold text-xl text-text-primary">{title}</h2>
            )}
        </div>
    );
}
