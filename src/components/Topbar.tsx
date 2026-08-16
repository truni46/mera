import NotchBar from "./NotchBar";
import TitleBar from "./TitleBar";

interface TopbarProps {
    title: string;
    isNew?: boolean;
}

export default function Topbar({ title, isNew }: TopbarProps) {
    return (
        <div>
            <NotchBar />
            <TitleBar title={title} isNew={isNew} />
        </div>
    );
}
