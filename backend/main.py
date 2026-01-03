from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
import os
from typing import Optional
import tempfile
import io

app = FastAPI(title="Transfer Guru API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Global dataframe storage
DATA_STORE = {
    "df": None,
    "filename": None
}

# Column names we need
COLUMNS_NEEDED = [
    "Legal Name", "Brand Name", "Acquirer", "Currency",
    "Amount", "Fee", "PSP Buy Fee", "Type", "Status"
]

HEADER_ROW = 15  # 0-indexed row where headers are


def load_xlsx_data_fast(file_path_or_buffer) -> pd.DataFrame:
    """Load xlsx file using pandas - much faster than openpyxl"""
    # Read only needed columns, skip first rows
    df = pd.read_excel(
        file_path_or_buffer,
        header=HEADER_ROW,
        usecols=lambda x: x in COLUMNS_NEEDED,
        engine='openpyxl'
    )

    # Rename columns to snake_case
    df.columns = df.columns.str.lower().str.replace(' ', '_')

    # Filter out rows with invalid type/status (formulas, nulls, numbers)
    df = df.dropna(subset=['type', 'status'])
    df = df[df['type'].apply(lambda x: isinstance(x, str) and not str(x).startswith('='))]
    df = df[df['status'].apply(lambda x: isinstance(x, str) and not str(x).startswith('='))]

    # Normalize type and status
    df['type'] = df['type'].str.lower().str.strip()
    df['status'] = df['status'].str.lower().str.strip()

    # Convert numeric columns
    for col in ['amount', 'fee', 'psp_buy_fee']:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)

    # Fill missing string columns
    for col in ['legal_name', 'brand_name', 'acquirer', 'currency']:
        if col in df.columns:
            df[col] = df[col].fillna('').astype(str)

    return df


def filter_by_operation_type(df: pd.DataFrame, op_type: int) -> pd.DataFrame:
    """Filter data by operation type"""
    if op_type == 1:
        return df[
            (df["type"] == "purchase") &
            (df["status"].isin(["paid", "refunded", "chargedback"]))
        ]
    elif op_type == 2:
        return df[(df["type"] == "refund") & (df["status"] == "success")]
    elif op_type == 3:
        return df[(df["type"] == "chargeback") & (df["status"] == "success")]
    elif op_type == 4:
        return df[(df["type"] == "payout") & (df["status"] == "success")]
    else:
        raise ValueError(f"Unknown operation type: {op_type}")


def build_pivot_by_acquirer(df: pd.DataFrame) -> dict:
    """Build pivot table grouped by: Acquirer → Legal Name → Currency"""
    if df.empty:
        return {"groups": [], "totals": {"amount": 0, "fee": 0, "psp_buy_fee": 0, "count": 0}}

    grouped = df.groupby(["acquirer", "legal_name", "currency"]).agg(
        amount=("amount", "sum"),
        fee=("fee", "sum"),
        psp_buy_fee=("psp_buy_fee", "sum"),
        count=("amount", "count")
    ).reset_index()

    result = {"groups": [], "totals": {
        "amount": round(float(grouped["amount"].sum()), 2),
        "fee": round(float(grouped["fee"].sum()), 2),
        "psp_buy_fee": round(float(grouped["psp_buy_fee"].sum()), 2),
        "count": int(grouped["count"].sum())
    }}

    for acquirer in grouped["acquirer"].unique():
        acq_data = grouped[grouped["acquirer"] == acquirer]
        acq_group = {
            "acquirer": acquirer,
            "merchants": [],
            "subtotals": {
                "amount": round(float(acq_data["amount"].sum()), 2),
                "fee": round(float(acq_data["fee"].sum()), 2),
                "psp_buy_fee": round(float(acq_data["psp_buy_fee"].sum()), 2),
                "count": int(acq_data["count"].sum())
            }
        }

        for legal_name in acq_data["legal_name"].unique():
            merchant_data = acq_data[acq_data["legal_name"] == legal_name]
            merchant_group = {
                "legal_name": legal_name,
                "currencies": [],
                "subtotals": {
                    "amount": round(float(merchant_data["amount"].sum()), 2),
                    "fee": round(float(merchant_data["fee"].sum()), 2),
                    "psp_buy_fee": round(float(merchant_data["psp_buy_fee"].sum()), 2),
                    "count": int(merchant_data["count"].sum())
                }
            }

            for _, row in merchant_data.iterrows():
                merchant_group["currencies"].append({
                    "currency": row["currency"],
                    "amount": round(float(row["amount"]), 2),
                    "fee": round(float(row["fee"]), 2),
                    "psp_buy_fee": round(float(row["psp_buy_fee"]), 2),
                    "count": int(row["count"])
                })

            acq_group["merchants"].append(merchant_group)

        result["groups"].append(acq_group)

    return result


def build_pivot_by_merchant(df: pd.DataFrame) -> dict:
    """Build pivot table grouped by: Legal Name → Acquirer → Currency"""
    if df.empty:
        return {"groups": [], "totals": {"amount": 0, "fee": 0, "psp_buy_fee": 0, "count": 0}}

    grouped = df.groupby(["legal_name", "acquirer", "currency"]).agg(
        amount=("amount", "sum"),
        fee=("fee", "sum"),
        psp_buy_fee=("psp_buy_fee", "sum"),
        count=("amount", "count")
    ).reset_index()

    result = {"groups": [], "totals": {
        "amount": round(float(grouped["amount"].sum()), 2),
        "fee": round(float(grouped["fee"].sum()), 2),
        "psp_buy_fee": round(float(grouped["psp_buy_fee"].sum()), 2),
        "count": int(grouped["count"].sum())
    }}

    for legal_name in grouped["legal_name"].unique():
        merchant_data = grouped[grouped["legal_name"] == legal_name]
        merchant_group = {
            "legal_name": legal_name,
            "acquirers": [],
            "subtotals": {
                "amount": round(float(merchant_data["amount"].sum()), 2),
                "fee": round(float(merchant_data["fee"].sum()), 2),
                "psp_buy_fee": round(float(merchant_data["psp_buy_fee"].sum()), 2),
                "count": int(merchant_data["count"].sum())
            }
        }

        for acquirer in merchant_data["acquirer"].unique():
            acq_data = merchant_data[merchant_data["acquirer"] == acquirer]
            acq_group = {
                "acquirer": acquirer,
                "currencies": [],
                "subtotals": {
                    "amount": round(float(acq_data["amount"].sum()), 2),
                    "fee": round(float(acq_data["fee"].sum()), 2),
                    "psp_buy_fee": round(float(acq_data["psp_buy_fee"].sum()), 2),
                    "count": int(acq_data["count"].sum())
                }
            }

            for _, row in acq_data.iterrows():
                acq_group["currencies"].append({
                    "currency": row["currency"],
                    "amount": round(float(row["amount"]), 2),
                    "fee": round(float(row["fee"]), 2),
                    "psp_buy_fee": round(float(row["psp_buy_fee"]), 2),
                    "count": int(row["count"])
                })

            merchant_group["acquirers"].append(acq_group)

        result["groups"].append(merchant_group)

    return result


@app.get("/")
async def root():
    return {"status": "ok", "message": "Transfer Guru API"}


@app.get("/api/status")
async def get_status():
    return {
        "loaded": DATA_STORE["df"] is not None,
        "filename": DATA_STORE["filename"],
        "row_count": len(DATA_STORE["df"]) if DATA_STORE["df"] is not None else 0
    }


@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload and parse xlsx file"""
    if not file.filename.endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Only .xlsx files are supported")

    try:
        # Read file content into memory
        content = await file.read()
        file_buffer = io.BytesIO(content)

        # Parse with pandas (faster)
        df = load_xlsx_data_fast(file_buffer)
        DATA_STORE["df"] = df
        DATA_STORE["filename"] = file.filename

        # Get stats
        type_counts = df.groupby(["type", "status"]).size().reset_index(name="count")
        stats = type_counts.to_dict(orient="records")

        return {
            "success": True,
            "filename": file.filename,
            "total_rows": len(df),
            "type_status_breakdown": stats
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing file: {str(e)}")


@app.post("/api/load-default")
async def load_default_file():
    """Load the default tab.xlsx file"""
    file_path = "/Users/lcc/transfer-guru/tab.xlsx"

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Default file not found")

    df = load_xlsx_data_fast(file_path)
    DATA_STORE["df"] = df
    DATA_STORE["filename"] = "tab.xlsx"

    type_counts = df.groupby(["type", "status"]).size().reset_index(name="count")
    stats = type_counts.to_dict(orient="records")

    return {
        "success": True,
        "filename": "tab.xlsx",
        "total_rows": len(df),
        "type_status_breakdown": stats
    }


@app.get("/api/pivot")
async def get_pivot(
    operation_type: int,
    view_type: int = 1,
    currency: Optional[str] = None
):
    """Get pivot table data"""
    if DATA_STORE["df"] is None:
        raise HTTPException(status_code=400, detail="No data loaded. Upload a file first.")

    df = DATA_STORE["df"].copy()
    df = filter_by_operation_type(df, operation_type)

    if currency:
        df = df[df["currency"] == currency.upper()]

    if view_type == 1:
        pivot = build_pivot_by_acquirer(df)
    else:
        pivot = build_pivot_by_merchant(df)

    return {
        "operation_type": operation_type,
        "view_type": view_type,
        "currency_filter": currency,
        "data": pivot
    }


@app.get("/api/currencies")
async def get_currencies():
    """Get list of unique currencies in the data"""
    if DATA_STORE["df"] is None:
        raise HTTPException(status_code=400, detail="No data loaded")

    currencies = sorted(DATA_STORE["df"]["currency"].unique().tolist())
    return {"currencies": currencies}


@app.get("/api/summary")
async def get_summary():
    """Get summary statistics for all operation types"""
    if DATA_STORE["df"] is None:
        raise HTTPException(status_code=400, detail="No data loaded")

    df = DATA_STORE["df"]
    summaries = []
    operation_names = {
        1: "Purchase (paid/refunded/chargedback)",
        2: "Refund (success)",
        3: "Chargeback (success)",
        4: "Payout (success)"
    }

    for op_type in [1, 2, 3, 4]:
        filtered = filter_by_operation_type(df, op_type)
        summaries.append({
            "operation_type": op_type,
            "name": operation_names[op_type],
            "count": len(filtered),
            "total_amount": round(float(filtered["amount"].sum()), 2),
            "total_fee": round(float(filtered["fee"].sum()), 2),
            "total_psp_buy_fee": round(float(filtered["psp_buy_fee"].sum()), 2)
        })

    return {"summaries": summaries}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
